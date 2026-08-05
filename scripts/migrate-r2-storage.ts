import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  PlataformaComprobanteTipo,
  PrismaClient,
  SunatAmbiente,
} from '@prisma/client';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { SunatCdrParserService } from '../src/modules/sunat-emission/sunat-cdr-parser.service';
import { sunatDocumentCode } from '../src/modules/sunat-emission/sunat-comprobante.helper';
import {
  SunatDocumentMetadata,
  sunatMetadataBody,
  sunatMetadataState,
} from '../src/modules/sunat-emission/sunat-document-storage.service';

process.env.DATABASE_URL ??= buildDatabaseUrl();

const apply = process.argv.includes('--apply');
const manifestPath = 'storage-r2-migration.manifest.json';
const manifest = existsSync(manifestPath)
  ? (JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, string>)
  : {};
const prisma = new PrismaClient();
const cdrParser = new SunatCdrParserService();
const client = new S3Client({
  region: 'auto',
  endpoint: `https://${required('CLOUDFLARE_R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: required('CLOUDFLARE_R2_ACCESS_KEY_ID'),
    secretAccessKey: required('CLOUDFLARE_R2_SECRET_ACCESS_KEY'),
  },
});
const sourceBucket =
  process.env.CLOUDFLARE_R2_LEGACY_BUCKET ?? required('CLOUDFLARE_R2_BUCKET');
const publicBucket = required('CLOUDFLARE_R2_PUBLIC_BUCKET');
const privateBucket = required('CLOUDFLARE_R2_PRIVATE_BUCKET');
const companyEnvironments = new Map<string, SunatAmbiente>();

async function main() {
  const objects = await listObjects(sourceBucket);
  const candidates = [] as Array<{
    source: string;
    destination: string;
    bucket: string;
  }>;

  for (const source of objects) {
    const target = await targetFor(source);
    if (target) candidates.push({ source, ...target });
  }

  console.log(
    `${apply ? 'MIGRACION' : 'DRY RUN'}: ${candidates.length} objetos de ${objects.length}`,
  );
  if (!apply) {
    for (const item of candidates.slice(0, 20))
      console.log(`${item.source} -> ${item.bucket}/${item.destination}`);
    console.log(
      'Ejecuta nuevamente con --apply para copiar y actualizar referencias.',
    );
    return;
  }

  for (const item of candidates) {
    const manifestKey = `${item.bucket}/${item.destination}`;
    if (
      !manifest[manifestKey] ||
      !(await destinationMatches(
        item.bucket,
        item.destination,
        manifest[manifestKey],
      ))
    ) {
      manifest[manifestKey] = await copyVerified(item);
      saveManifest();
    }
    if (item.source !== item.destination) {
      await updateReferences(item.source, item.destination);
    }
  }

  for (const item of candidates.filter((value) =>
    value.source.endsWith('.xml'),
  )) {
    await migrateMetadata(item.source, item.destination);
  }

  console.log(
    `Migracion verificada. Originales conservados en ${sourceBucket}.`,
  );
}

async function targetFor(key: string) {
  if (key.startsWith('products/') || key.startsWith('logos/')) {
    return { bucket: publicBucket, destination: key };
  }
  if (key.startsWith('sunat-certificates/')) {
    return { bucket: privateBucket, destination: key };
  }
  const company = key.match(
    /^sunat\/empresa-(\d+)\/(?!BETA\/|PRODUCCION\/)(.+)$/,
  );
  if (company) {
    const ambiente = await companyEnvironment(company[1]);
    return {
      bucket: privateBucket,
      destination: `sunat/empresa-${company[1]}/${ambiente}/${company[2]}`,
    };
  }
  const platform = key.match(
    /^sunat\/plataforma\/(?!BETA\/|PRODUCCION\/)(.+)$/,
  );
  if (platform) {
    const config = await prisma.configuracionFacturacionPlataforma.findUnique({
      where: { id: 1 },
      select: { ambiente: true },
    });
    if (!config)
      throw new Error('No existe configuracion fiscal de plataforma');
    return {
      bucket: privateBucket,
      destination: `sunat/plataforma/${config.ambiente}/${platform[1]}`,
    };
  }
  return null;
}

async function companyEnvironment(id: string) {
  const cached = companyEnvironments.get(id);
  if (cached) return cached;
  const config = await prisma.sunatConfig.findUnique({
    where: { empresaId: BigInt(id) },
    select: { ambiente: true },
  });
  if (!config) throw new Error(`Empresa ${id} sin configuracion SUNAT`);
  companyEnvironments.set(id, config.ambiente);
  return config.ambiente;
}

async function copyVerified(item: {
  source: string;
  destination: string;
  bucket: string;
}) {
  const source = await readObject(sourceBucket, item.source);
  await client.send(
    new PutObjectCommand({
      Bucket: item.bucket,
      Key: item.destination,
      Body: source.bytes,
      ContentType: source.contentType,
    }),
  );
  const destination = await readObject(item.bucket, item.destination);
  const sourceHash = sha256(source.bytes);
  if (sourceHash !== sha256(destination.bytes)) {
    throw new Error(`Hash distinto al copiar ${item.source}`);
  }
  console.log(`OK ${item.source}`);
  return sourceHash;
}

async function migrateMetadata(oldXmlKey: string, newXmlKey: string) {
  const record = await findDocument(oldXmlKey, newXmlKey);
  if (!record) return;
  let estado: SunatDocumentMetadata['estado'] = 'PENDIENTE';
  if (record.cdrKey) {
    const cdrBucket =
      record.cdrKey.includes('/BETA/') || record.cdrKey.includes('/PRODUCCION/')
        ? privateBucket
        : sourceBucket;
    const cdr = await cdrParser.parse(
      (await readObject(cdrBucket, record.cdrKey)).bytes,
    );
    estado = sunatMetadataState(cdr.estado);
  }
  const metadata: SunatDocumentMetadata = {
    ambiente: record.ambiente,
    tipoDoc: record.tipoDoc,
    serie: record.serie,
    correlativo: record.correlativo,
    ticket: record.ticket,
    estado,
    fechaEmision: record.fechaEmision.toISOString().slice(0, 10),
    fechaEnvio: (record.fechaEnvio ?? record.fechaEmision).toISOString(),
    fechaProcesado: record.fechaProcesado?.toISOString() ?? null,
  };
  const key = newXmlKey.replace(/\.xml$/i, '.metadata.json');
  const manifestKey = `${privateBucket}/${key}`;
  if (
    manifest[manifestKey] &&
    (await destinationMatches(privateBucket, key, manifest[manifestKey]))
  )
    return;
  const body = sunatMetadataBody(metadata);
  await client.send(
    new PutObjectCommand({
      Bucket: privateBucket,
      Key: key,
      Body: body,
      ContentType: 'application/json',
    }),
  );
  const stored = await readObject(privateBucket, key);
  if (sha256(body) !== sha256(stored.bytes))
    throw new Error(`Metadata corrupta: ${key}`);
  manifest[manifestKey] = sha256(body);
  saveManifest();
}

async function findDocument(oldKey: string, newKey: string) {
  const keyFilter = { in: [oldKey, newKey] };
  const companyMatch = newKey.match(
    /^sunat\/empresa-(\d+)\/(BETA|PRODUCCION)\//,
  );
  const ambiente =
    (companyMatch?.[2] as SunatAmbiente | undefined) ??
    (
      await prisma.configuracionFacturacionPlataforma.findUnique({
        where: { id: 1 },
        select: { ambiente: true },
      })
    )?.ambiente;
  if (!ambiente) return null;

  const sale = await prisma.venta.findFirst({
    where: { sunatXmlKey: keyFilter },
  });
  if (sale)
    return documentRecord(
      ambiente,
      sunatDocumentCode(sale.tipoComprobante),
      sale.serie,
      sale.numero,
      null,
      sale.createdAt,
      sale.sunatEnviadoAt,
      sale.sunatRespondidoAt,
      sale.sunatCdrKey,
    );
  const note = await prisma.notaCredito.findFirst({
    where: { sunatXmlKey: keyFilter },
  });
  if (note)
    return documentRecord(
      ambiente,
      '07',
      note.serie,
      note.numero,
      null,
      note.createdAt,
      note.sunatEnviadoAt,
      note.sunatRespondidoAt,
      note.sunatCdrKey,
    );
  const guide = await prisma.guiaRemision.findFirst({
    where: { sunatXmlKey: keyFilter },
  });
  if (guide)
    return documentRecord(
      ambiente,
      '09',
      guide.serie,
      guide.numero,
      guide.sunatTicket,
      guide.fechaEmision,
      guide.sunatEnviadoAt,
      guide.sunatRespondidoAt,
      guide.sunatCdrKey,
    );
  const baja = await prisma.sunatBajaLote.findFirst({
    where: { sunatXmlKey: keyFilter },
  });
  if (baja)
    return documentRecord(
      ambiente,
      baja.tipoEnvio,
      baja.tipoEnvio,
      baja.correlativo,
      baja.ticketSunat,
      baja.fechaGeneracion,
      baja.sunatEnviadoAt,
      baja.sunatRespondidoAt,
      baja.sunatCdrKey,
      3,
    );
  const platform = await prisma.comprobantePlataforma.findFirst({
    where: { xmlR2Key: keyFilter },
  });
  if (platform)
    return documentRecord(
      ambiente,
      platformTypeCode(platform.tipo),
      platform.serie,
      platform.numero,
      null,
      platform.fechaEmision,
      platform.createdAt,
      platform.updatedAt,
      platform.cdrR2Key,
    );
  const platformBaja = await prisma.comprobantePlataforma.findFirst({
    where: { sunatBajaXmlR2Key: keyFilter },
  });
  if (
    platformBaja?.sunatBajaTipo &&
    platformBaja.sunatBajaCorrelativo &&
    platformBaja.sunatBajaSolicitadaAt
  )
    return documentRecord(
      ambiente,
      platformBaja.sunatBajaTipo,
      platformBaja.sunatBajaTipo,
      platformBaja.sunatBajaCorrelativo,
      platformBaja.sunatBajaTicket,
      platformBaja.sunatBajaSolicitadaAt,
      platformBaja.sunatBajaSolicitadaAt,
      platformBaja.sunatBajaRespondidaAt,
      platformBaja.sunatBajaCdrR2Key,
      3,
    );
  return null;
}

function documentRecord(
  ambiente: SunatAmbiente,
  tipoDoc: string,
  serie: string,
  numero: number,
  ticket: string | null,
  fechaEmision: Date,
  fechaEnvio: Date | null,
  fechaProcesado: Date | null,
  cdrKey: string | null,
  width = 8,
) {
  return {
    ambiente,
    tipoDoc,
    serie,
    correlativo: numero.toString().padStart(width, '0'),
    ticket,
    fechaEmision,
    fechaEnvio,
    fechaProcesado,
    cdrKey,
  };
}

function platformTypeCode(tipo: PlataformaComprobanteTipo) {
  return tipo === PlataformaComprobanteTipo.factura
    ? '01'
    : tipo === PlataformaComprobanteTipo.boleta
      ? '03'
      : '07';
}

async function updateReferences(oldKey: string, newKey: string) {
  const fields = [
    ['venta', 'sunat_xml_key'],
    ['venta', 'sunat_zip_key'],
    ['venta', 'sunat_cdr_key'],
    ['nota_credito', 'sunat_xml_key'],
    ['nota_credito', 'sunat_zip_key'],
    ['nota_credito', 'sunat_cdr_key'],
    ['guia_remision', 'sunat_xml_key'],
    ['guia_remision', 'sunat_zip_key'],
    ['guia_remision', 'sunat_cdr_key'],
    ['sunat_baja_lote', 'sunat_xml_key'],
    ['sunat_baja_lote', 'sunat_zip_key'],
    ['sunat_baja_lote', 'sunat_cdr_key'],
    ['comprobante_plataforma', 'xml_r2_key'],
    ['comprobante_plataforma', 'cdr_r2_key'],
    ['comprobante_plataforma', 'sunat_baja_xml_r2_key'],
    ['comprobante_plataforma', 'sunat_baja_cdr_r2_key'],
  ];
  for (const [table, column] of fields) {
    await prisma.$executeRawUnsafe(
      `UPDATE "${table}" SET "${column}" = $1 WHERE "${column}" = $2`,
      newKey,
      oldKey,
    );
  }
}

async function listObjects(bucket: string) {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const page = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }),
    );
    keys.push(
      ...(page.Contents ?? []).flatMap((item) => (item.Key ? [item.Key] : [])),
    );
    token = page.NextContinuationToken;
  } while (token);
  return keys;
}

async function readObject(bucket: string, key: string) {
  const response = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
  );
  const chunks: Buffer[] = [];
  for await (const chunk of response.Body as AsyncIterable<Uint8Array>)
    chunks.push(Buffer.from(chunk));
  return { bytes: Buffer.concat(chunks), contentType: response.ContentType };
}

async function destinationMatches(bucket: string, key: string, hash: string) {
  try {
    return sha256((await readObject(bucket, key)).bytes) === hash;
  } catch {
    return false;
  }
}

function sha256(value: Buffer) {
  return createHash('sha256').update(value).digest('hex');
}

function saveManifest() {
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

function required(key: string) {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`${key} es obligatorio`);
  return value;
}

function buildDatabaseUrl() {
  const password = encodeURIComponent(process.env.DB_PASSWORD ?? '');
  return `postgresql://${process.env.DB_USER ?? 'postgres'}:${password}@${process.env.DB_HOST ?? 'localhost'}:${process.env.DB_PORT ?? '5432'}/${process.env.DB_NAME ?? 'Nobitex'}?schema=public`;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

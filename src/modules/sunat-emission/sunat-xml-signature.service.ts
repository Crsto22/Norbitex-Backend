import { BadRequestException, Injectable } from '@nestjs/common';
import { SignedXml } from 'xml-crypto';
import forge from 'node-forge';
import { SecretsCryptoService } from '../../common/crypto/secrets-crypto.service';
import { R2StorageService } from '../storage/r2-storage.service';

@Injectable()
export class SunatXmlSignatureService {
  constructor(
    private readonly r2StorageService: R2StorageService,
    private readonly secretsCryptoService: SecretsCryptoService,
  ) {}

  async sign(params: {
    xml: string;
    certificadoR2Key: string;
    certificadoPasswordEncrypted: string;
  }) {
    const password = this.secretsCryptoService.decrypt(
      params.certificadoPasswordEncrypted,
    );
    const pfx = await this.r2StorageService.downloadSunatCertificate(
      params.certificadoR2Key,
    );
    const { privateKeyPem, certificatePem } = this.extractPkcs12Keys(
      pfx,
      password,
    );
    const signature = new SignedXml({
      privateKey: privateKeyPem,
      publicCert: certificatePem,
      signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
      canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#',
      getKeyInfoContent: (args) => {
        const tagPrefix = args?.prefix ? `${args.prefix}:` : '';
        const cert = certificatePem
          .replace(/-----BEGIN CERTIFICATE-----/g, '')
          .replace(/-----END CERTIFICATE-----/g, '')
          .replace(/\s+/g, '');
        return `<${tagPrefix}X509Data><${tagPrefix}X509Certificate>${cert}</${tagPrefix}X509Certificate></${tagPrefix}X509Data>`;
      },
    });

    signature.addReference({
      xpath:
        "//*[local-name(.)='Invoice' or local-name(.)='CreditNote' or local-name(.)='DespatchAdvice' or local-name(.)='VoidedDocuments' or local-name(.)='SummaryDocuments']",
      transforms: [
        'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
        'http://www.w3.org/2001/10/xml-exc-c14n#',
      ],
      digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
      uri: '',
      isEmptyUri: true,
    });
    signature.computeSignature(params.xml, {
      prefix: 'ds',
      location: {
        reference: "//*[local-name(.)='ExtensionContent']",
        action: 'append',
      },
    });

    const signedXml = signature.getSignedXml();
    const digestValue = this.extractDigestValue(signedXml);

    return {
      xml: signedXml,
      digestValue,
      bytes: Buffer.from(signedXml, 'utf8'),
    };
  }

  private extractPkcs12Keys(buffer: Buffer, password: string) {
    try {
      const asn1 = forge.asn1.fromDer(buffer.toString('binary'));
      const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, password);
      const keyBag =
        p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[
          forge.pki.oids.pkcs8ShroudedKeyBag
        ]?.[0] ??
        p12.getBags({ bagType: forge.pki.oids.keyBag })[
          forge.pki.oids.keyBag
        ]?.[0];
      const certBag = p12.getBags({ bagType: forge.pki.oids.certBag })[
        forge.pki.oids.certBag
      ]?.[0];

      if (!keyBag?.key || !certBag?.cert) {
        throw new Error('Missing key or certificate');
      }

      return {
        privateKeyPem: forge.pki.privateKeyToPem(keyBag.key),
        certificatePem: forge.pki.certificateToPem(certBag.cert),
      };
    } catch {
      throw new BadRequestException(
        'No se pudo abrir el certificado SUNAT con la contrasena configurada',
      );
    }
  }

  private extractDigestValue(xml: string) {
    const match = xml.match(/<ds:DigestValue>([^<]+)<\/ds:DigestValue>/);
    if (!match?.[1]) {
      throw new BadRequestException(
        'No se pudo obtener el hash del XML firmado',
      );
    }

    return match[1];
  }
}

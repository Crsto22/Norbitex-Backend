import { Injectable } from '@nestjs/common';

@Injectable()
export class SunatSoapClientService {
  async sendBill(params: {
    endpoint: string;
    username: string;
    password: string;
    zipFileName: string;
    zipBytes: Buffer;
  }) {
    const body = this.buildEnvelope({
      username: params.username,
      password: params.password,
      fileName: params.zipFileName,
      contentFile: params.zipBytes.toString('base64'),
    });
    const response = await fetch(params.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        SOAPAction: '"urn:sendBill"',
      },
      body,
    });
    const text = await response.text();

    if (!response.ok) {
      throw new Error(this.parseFault(text) || `SUNAT HTTP ${response.status}`);
    }

    const fault = this.parseFault(text);
    if (fault) {
      throw new Error(fault);
    }

    const applicationResponse = this.firstTag(text, 'applicationResponse');
    if (!applicationResponse) {
      throw new Error('SUNAT respondio sin applicationResponse');
    }

    return {
      cdrZipFileName: `R-${params.zipFileName}`,
      cdrZipBytes: Buffer.from(applicationResponse, 'base64'),
    };
  }

  async sendSummary(params: {
    endpoint: string;
    username: string;
    password: string;
    zipFileName: string;
    zipBytes: Buffer;
  }) {
    const body = this.buildEnvelope({
      username: params.username,
      password: params.password,
      operation: 'sendSummary',
      fileName: params.zipFileName,
      contentFile: params.zipBytes.toString('base64'),
    });
    const response = await fetch(params.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        SOAPAction: '"urn:sendSummary"',
      },
      body,
    });
    const text = await response.text();

    if (!response.ok) {
      throw new Error(this.parseFault(text) || `SUNAT HTTP ${response.status}`);
    }

    const fault = this.parseFault(text);
    if (fault) {
      throw new Error(fault);
    }

    const ticket = this.firstTag(text, 'ticket');
    if (!ticket) {
      throw new Error('SUNAT respondio sin ticket para el resumen de baja');
    }

    return { ticket };
  }

  async getStatus(params: {
    endpoint: string;
    username: string;
    password: string;
    ticket: string;
  }) {
    const body = this.buildStatusEnvelope(params);
    const response = await fetch(params.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        SOAPAction: '"urn:getStatus"',
      },
      body,
    });
    const text = await response.text();

    if (!response.ok) {
      throw new Error(this.parseFault(text) || `SUNAT HTTP ${response.status}`);
    }

    const fault = this.parseFault(text);
    if (fault) {
      throw new Error(fault);
    }

    const statusCode = this.firstTag(text, 'statusCode');
    const content = this.firstTag(text, 'content');

    return {
      statusCode,
      cdrZipFileName: `R-${params.ticket}.zip`,
      cdrZipBytes: content ? Buffer.from(content, 'base64') : null,
    };
  }

  private buildEnvelope(params: {
    username: string;
    password: string;
    operation?: 'sendBill' | 'sendSummary';
    fileName: string;
    contentFile: string;
  }) {
    const operation = params.operation ?? 'sendBill';
    return `
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:ser="http://service.sunat.gob.pe"
                  xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">
  <soapenv:Header>
    <wsse:Security>
      <wsse:UsernameToken>
        <wsse:Username>${this.escape(params.username)}</wsse:Username>
        <wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordText">${this.escape(params.password)}</wsse:Password>
      </wsse:UsernameToken>
    </wsse:Security>
  </soapenv:Header>
  <soapenv:Body>
    <ser:${operation}>
      <fileName>${this.escape(params.fileName)}</fileName>
      <contentFile>${params.contentFile}</contentFile>
    </ser:${operation}>
  </soapenv:Body>
</soapenv:Envelope>`;
  }

  private buildStatusEnvelope(params: {
    username: string;
    password: string;
    ticket: string;
  }) {
    return `
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:ser="http://service.sunat.gob.pe"
                  xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">
  <soapenv:Header>
    <wsse:Security>
      <wsse:UsernameToken>
        <wsse:Username>${this.escape(params.username)}</wsse:Username>
        <wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordText">${this.escape(params.password)}</wsse:Password>
      </wsse:UsernameToken>
    </wsse:Security>
  </soapenv:Header>
  <soapenv:Body>
    <ser:getStatus>
      <ticket>${this.escape(params.ticket)}</ticket>
    </ser:getStatus>
  </soapenv:Body>
</soapenv:Envelope>`;
  }

  private parseFault(xml: string) {
    return this.firstTag(xml, 'faultstring') || this.firstTag(xml, 'message');
  }

  private firstTag(xml: string, localName: string) {
    const pattern = new RegExp(
      `<[^>]*:?${localName}[^>]*>([\\s\\S]*?)<\\/[^>]*:?${localName}>`,
      'i',
    );
    const match = xml.match(pattern);
    return match?.[1]?.trim() || null;
  }

  private escape(value: string) {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}

// Type declarations for @sendgrid/mail
// Package doesn't include official TypeScript definitions

declare module '@sendgrid/mail' {
  export interface MailDataRequired {
    to: string | string[];
    from: string;
    subject: string;
    text?: string;
    html?: string;
    templateId?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    dynamicTemplateData?: Record<string, any>;
  }

  export interface ResponseError extends Error {
    code?: number;
    response?: {
      headers?: Record<string, string>;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      body?: any;
    };
  }

  export interface ClientResponse {
    statusCode: number;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    body: any;
    headers: Record<string, string>;
  }

  export function setApiKey(apiKey: string): void;
  export function send(data: MailDataRequired): Promise<[ClientResponse, Record<string, never>]>;
  export function sendMultiple(
    data: MailDataRequired,
  ): Promise<[ClientResponse, Record<string, never>]>;
}

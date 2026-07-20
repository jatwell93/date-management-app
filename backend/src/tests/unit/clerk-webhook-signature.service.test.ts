import { ClerkWebhookSignatureService } from '../../services/clerk-webhook-signature.service';

describe('ClerkWebhookSignatureService', () => {
  it('verifies signatures using Svix headers', () => {
    const verify = vi.fn().mockReturnValue({ type: 'user.created' });
    const service = new ClerkWebhookSignatureService('whsec_test_123', () => ({ verify }));
    const payload = Buffer.from('{"type":"user.created"}');

    const result = service.verifySignature(payload, {
      'svix-id': 'msg_123',
      'svix-timestamp': '1710000000',
      'svix-signature': 'sig_123',
    });

    expect(result).toEqual({ type: 'user.created' });
    expect(verify).toHaveBeenCalledWith('{"type":"user.created"}', {
      'svix-id': 'msg_123',
      'svix-timestamp': '1710000000',
      'svix-signature': 'sig_123',
    });
  });

  it('throws when required headers are missing', () => {
    const service = new ClerkWebhookSignatureService('whsec_test_123');

    expect(() =>
      service.verifySignature(Buffer.from('{"type":"user.created"}'), {
        'svix-id': 'msg_123',
        'svix-timestamp': '1710000000',
      }),
    ).toThrow('Missing required Svix headers');
  });
});

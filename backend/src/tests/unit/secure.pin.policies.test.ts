import { AuthService } from '../../services/auth.service';

describe('Secure PIN Policies', () => {
  let authService: AuthService;

  beforeEach(() => {
    authService = new AuthService();
  });

  describe('PIN validation', () => {
    it('should accept valid PINs (4-6 digits)', () => {
      // Use PINs that are NOT sequential or repeating
      const validPins = ['1593', '95123', '852069', '741258'];

      validPins.forEach((pin) => {
        const result = authService.validatePin(pin);
        expect(result.isValid).toBe(true);
      });
    });

    it('should reject PINs that are too short', () => {
      const invalidPins = ['123', '12', '1'];

      invalidPins.forEach((pin) => {
        const result = authService.validatePin(pin);
        expect(result.isValid).toBe(false);
        expect(result.message).toContain('must be 4-6 digits');
      });
    });

    it('should reject PINs that are too long', () => {
      const invalidPins = ['1234567', '1234567890123'];

      invalidPins.forEach((pin) => {
        const result = authService.validatePin(pin);
        expect(result.isValid).toBe(false);
        expect(result.message).toContain('must be 4-6 digits');
      });
    });

    it('should reject PINs with non-digit characters', () => {
      const invalidPins = ['123a', '1234b5', 'abcd'];

      invalidPins.forEach((pin) => {
        const result = authService.validatePin(pin);
        expect(result.isValid).toBe(false);
        expect(result.message).toContain('must be 4-6 digits');
      });
    });

    it('should reject predictable PIN patterns', () => {
      const predictablePins = [
        '1234',
        '2345',
        '3456',
        '4567',
        '5678',
        '6789',
        '7890', // Sequential
        '0987',
        '9876',
        '8765',
        '7654',
        '6543',
        '5432',
        '4321',
        '3210', // Reverse sequential
        '1111',
        '2222',
        '3333',
        '4444',
        '5555',
        '6666',
        '7777',
        '8888',
        '9999',
        '0000', // Repeating
        '2580',
        '0852',
        '1470',
        '0741', // Vertical keypad patterns
      ];

      predictablePins.forEach((pin) => {
        const result = authService.validatePin(pin);
        expect(result.isValid).toBe(false);
        expect(result.message).toContain('predictable patterns');
      });
    });

    it('should accept non-predictable PINs', () => {
      const nonPredictablePins = ['1357', '2468', '1324', '5691', '8347'];

      nonPredictablePins.forEach((pin) => {
        const result = authService.validatePin(pin);
        expect(result.isValid).toBe(true);
      });
    });
  });

  describe('PIN hashing and verification', () => {
    it('should hash and verify PINs correctly', async () => {
      const pin = '1234';
      const hashedPin = await authService.hashPin(pin);

      // PIN should be different after hashing
      expect(hashedPin).not.toBe(pin);

      // Verification should succeed
      const isValid = await authService.verifyPin(pin, hashedPin);
      expect(isValid).toBe(true);
    });

    it('should not verify incorrect PINs', async () => {
      const pin = '1234';
      const wrongPin = '4321';
      const hashedPin = await authService.hashPin(pin);

      // Verification with wrong PIN should fail
      const isValid = await authService.verifyPin(wrongPin, hashedPin);
      expect(isValid).toBe(false);
    });
  });
});

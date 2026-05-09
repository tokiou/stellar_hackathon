import { PublicKey } from '@solana/web3.js';
import type {
  RiskProvider,
  RiskProviderInput,
  RiskProviderResult,
  RiskReason,
} from '../../types';

/**
 * Recipient validation provider - validates transfer recipient addresses.
 * 
 * Rules:
 * - Invalid Solana public key: BLOCKED
 * - .sol name cannot be resolved: BLOCKED (SNS not yet implemented)
 * - Contact name not found: BLOCKED
 * - New address not in contacts: MEDIUM
 * - Known saved contact: LOW
 */
export class RecipientValidationProvider implements RiskProvider {
  readonly name = 'RecipientValidation';
  readonly source = 'Recipient Address Validator';

  // In a real app, this would come from user's saved contacts
  private readonly savedContacts: Map<string, string> = new Map();

  async assess(input: RiskProviderInput): Promise<RiskProviderResult> {
    const signals: RiskReason[] = [];

    try {
      // Only validate recipients for transfer intents
      if (input.intent.action !== 'transfer') {
        return {
          provider: this.name,
          status: 'success',
          signals: [],
        };
      }

      const { recipient } = input.intent;

      // Check for .sol domain names
      if (recipient.endsWith('.sol')) {
        signals.push({
          label: 'SNS Name Not Supported',
          detail: `${recipient} is a .sol domain name. SNS resolution is not yet implemented in this MVP.`,
          severity: 'BLOCKED',
          checkName: 'recipient_validation',
          source: this.source,
          value: recipient,
          threshold: 'Must be a valid Solana public key',
          riskImpact: 'BLOCKED',
          explanation: '.sol domain name resolution is not available yet. Please use a full Solana address.',
          metadata: { recipient, type: 'sns_name' },
        });
        
        return {
          provider: this.name,
          status: 'success',
          signals,
        };
      }

      // Check for contact names (simple heuristic: not base58 format)
      if (recipient.length < 32 || recipient.includes(' ') || !/^[1-9A-HJ-NP-Za-km-z]+$/.test(recipient)) {
        signals.push({
          label: 'Contact Name Not Found',
          detail: `"${recipient}" appears to be a contact name, but it was not found in your saved contacts.`,
          severity: 'BLOCKED',
          checkName: 'recipient_validation',
          source: this.source,
          value: recipient,
          threshold: 'Must be a saved contact or valid Solana address',
          riskImpact: 'BLOCKED',
          explanation: 'Contact names must be saved in your address book before use.',
          metadata: { recipient, type: 'contact_name' },
        });
        
        return {
          provider: this.name,
          status: 'success',
          signals,
        };
      }

      // Validate as Solana public key
      try {
        new PublicKey(recipient);
      } catch {
        signals.push({
          label: 'Invalid Solana Address',
          detail: `${recipient} is not a valid Solana public key.`,
          severity: 'BLOCKED',
          checkName: 'recipient_validation',
          source: this.source,
          value: recipient,
          threshold: 'Must be a valid base58 Solana public key',
          riskImpact: 'BLOCKED',
          explanation: 'The recipient address is not a valid Solana public key.',
          metadata: { recipient, type: 'invalid_address' },
        });
        
        return {
          provider: this.name,
          status: 'success',
          signals,
        };
      }

      // Address is valid - check if it's a known contact
      if (this.savedContacts.has(recipient)) {
        signals.push({
          label: 'Known Contact',
          detail: `Sending to saved contact: ${this.savedContacts.get(recipient)}`,
          severity: 'LOW',
          checkName: 'recipient_validation',
          source: this.source,
          value: recipient,
          threshold: 'Saved contact',
          riskImpact: 'LOW',
          explanation: 'This is a saved contact in your address book.',
          metadata: { 
            recipient,
            type: 'saved_contact',
            contactName: this.savedContacts.get(recipient),
          },
        });
      } else {
        // New address - medium risk
        signals.push({
          label: 'New Recipient Address',
          detail: `This is a new address not in your saved contacts. Please verify carefully.`,
          severity: 'MEDIUM',
          checkName: 'recipient_validation',
          source: this.source,
          value: recipient,
          threshold: 'New addresses are MEDIUM risk',
          riskImpact: 'MEDIUM',
          explanation: 'Always verify new addresses carefully before sending. Double-check with the recipient through another channel.',
          metadata: { recipient, type: 'new_address' },
        });
      }

      return {
        provider: this.name,
        status: 'success',
        signals,
      };
    } catch (error) {
      return {
        provider: this.name,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}

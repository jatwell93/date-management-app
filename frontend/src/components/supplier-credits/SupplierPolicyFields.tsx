import React from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { PolicyMarkdown } from './PolicyMarkdown';

export interface SupplierPolicyDraft {
  contactEmail: string;
  contactPhone: string;
  creditPolicyNote: string;
  policyWriteOffQty: string;
  policyCreditQty: string;
  followUpDays: string;
  representativeName: string;
  representativeEmail: string;
}

interface Props {
  value: SupplierPolicyDraft;
  onChange: (field: keyof SupplierPolicyDraft, value: string) => void;
  fieldErrors: Record<string, string>;
  editableContacts: boolean;
  editablePolicy: boolean;
  preview: boolean;
  onPreviewChange: (preview: boolean) => void;
  idPrefix: string;
}

const FieldError: React.FC<{ message?: string }> = ({ message }) =>
  message ? <p className="mt-1 text-xs text-semantic-critical">{message}</p> : null;

export const SupplierPolicyFields: React.FC<Props> = ({
  value,
  onChange,
  fieldErrors,
  editableContacts,
  editablePolicy,
  preview,
  onPreviewChange,
  idPrefix,
}) => {
  const fieldId = (field: keyof SupplierPolicyDraft) => `${idPrefix}-${field}`;

  return (
    <div className="space-y-4">
      {editableContacts ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor={fieldId('contactEmail')}>Contact email</Label>
            <Input
              id={fieldId('contactEmail')}
              type="email"
              maxLength={255}
              value={value.contactEmail}
              onChange={(event) => onChange('contactEmail', event.target.value)}
            />
            <FieldError message={fieldErrors.contactEmail} />
          </div>
          <div>
            <Label htmlFor={fieldId('contactPhone')}>Contact phone</Label>
            <Input
              id={fieldId('contactPhone')}
              maxLength={80}
              value={value.contactPhone}
              onChange={(event) => onChange('contactPhone', event.target.value)}
            />
            <FieldError message={fieldErrors.contactPhone} />
          </div>
          <FieldError message={fieldErrors.contact} />
        </div>
      ) : (
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-semantic-text-tertiary">Contact email</dt>
            <dd>{value.contactEmail || 'Not provided'}</dd>
          </div>
          <div>
            <dt className="text-semantic-text-tertiary">Contact phone</dt>
            <dd>{value.contactPhone || 'Not provided'}</dd>
          </div>
        </dl>
      )}

      {editablePolicy ? (
        <>
          <div>
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor={fieldId('creditPolicyNote')}>Store instructions</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onPreviewChange(!preview)}
              >
                {preview ? 'Edit instructions' : 'Preview instructions'}
              </Button>
            </div>
            {preview ? (
              <div className="mt-1 min-h-24 rounded-md border bg-semantic-surface-2 p-3">
                {value.creditPolicyNote.trim() ? (
                  <PolicyMarkdown value={value.creditPolicyNote} />
                ) : (
                  <p className="text-sm text-semantic-text-tertiary">No instructions to preview.</p>
                )}
              </div>
            ) : (
              <textarea
                id={fieldId('creditPolicyNote')}
                maxLength={10000}
                rows={6}
                className="mt-1 w-full rounded-md border bg-semantic-surface-1 px-3 py-2 text-sm outline-none focus-visible:border-semantic-primary focus-visible:ring-2 focus-visible:ring-semantic-primary/30"
                value={value.creditPolicyNote}
                onChange={(event) => onChange('creditPolicyNote', event.target.value)}
              />
            )}
            <FieldError message={fieldErrors.creditPolicyNote} />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor={fieldId('representativeName')}>Representative name</Label>
              <Input
                id={fieldId('representativeName')}
                maxLength={120}
                value={value.representativeName}
                onChange={(event) => onChange('representativeName', event.target.value)}
              />
              <FieldError message={fieldErrors.representativeName} />
            </div>
            <div>
              <Label htmlFor={fieldId('representativeEmail')}>Representative email</Label>
              <Input
                id={fieldId('representativeEmail')}
                type="email"
                maxLength={255}
                value={value.representativeEmail}
                onChange={(event) => onChange('representativeEmail', event.target.value)}
              />
              <FieldError message={fieldErrors.representativeEmail} />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor={fieldId('policyWriteOffQty')}>Write off</Label>
              <Input
                id={fieldId('policyWriteOffQty')}
                type="number"
                min="1"
                value={value.policyWriteOffQty}
                onChange={(event) => onChange('policyWriteOffQty', event.target.value)}
              />
            </div>
            <div>
              <Label htmlFor={fieldId('policyCreditQty')}>Credit</Label>
              <Input
                id={fieldId('policyCreditQty')}
                type="number"
                min="0"
                value={value.policyCreditQty}
                onChange={(event) => onChange('policyCreditQty', event.target.value)}
              />
            </div>
            <div>
              <Label htmlFor={fieldId('followUpDays')}>Follow up days</Label>
              <Input
                id={fieldId('followUpDays')}
                type="number"
                min="1"
                value={value.followUpDays}
                onChange={(event) => onChange('followUpDays', event.target.value)}
              />
            </div>
          </div>
          <p className="text-xs text-semantic-text-tertiary">
            Ratio example: write off 3 for a credit of 1. Leave both blank if there is no fixed
            ratio.
          </p>
        </>
      ) : value.creditPolicyNote.trim() ? (
        <div>
          <p className="mb-2 text-sm font-medium">Store instructions</p>
          <div className="rounded-md border bg-semantic-surface-2 p-3">
            <PolicyMarkdown value={value.creditPolicyNote} />
          </div>
          <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-semantic-text-tertiary">Representative</dt>
              <dd>{value.representativeName || 'Not provided'}</dd>
            </div>
            <div>
              <dt className="text-semantic-text-tertiary">Representative email</dt>
              <dd>{value.representativeEmail || 'Not provided'}</dd>
            </div>
          </dl>
        </div>
      ) : (
        <p className="rounded-md bg-semantic-surface-2 p-3 text-sm text-semantic-text-secondary">
          No supplier policy has been captured. An admin can add store instructions.
        </p>
      )}
    </div>
  );
};

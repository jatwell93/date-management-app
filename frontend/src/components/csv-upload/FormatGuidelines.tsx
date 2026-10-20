import React, { forwardRef } from 'react';

// One neutral chip style: the surrounding text already says which values are required,
// accepted or rejected, so chip colour carries no extra meaning.
const Chip: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <code className="rounded border border-hairline bg-semantic-surface-1 px-1">{children}</code>
);

const listClassName = 'list-disc pl-5 space-y-1 text-sm text-semantic-primary-muted-foreground';

const ExpiryGuidelines: React.FC = () => (
  <ul className={listClassName}>
    <li>
      Required columns: <Chip>SKU</Chip>, <Chip>Used-By Date</Chip>
    </li>
    <li>
      Optional columns: <Chip>Item Description</Chip>, <Chip>Department</Chip>
    </li>
    <li>
      Accepted date formats: <Chip>dd/mm/yy</Chip>, <Chip>dd/mm/yyyy</Chip>, <Chip>mm/yy</Chip>,{' '}
      <Chip>mm/yyyy</Chip>, <Chip>mm-yy</Chip>, <Chip>mm-yyyy</Chip>
    </li>
    <li>
      Rejected examples: <Chip>12/12</Chip> (ambiguous), <Chip>Dec/2026</Chip> (month names
      unsupported)
    </li>
  </ul>
);

const CatalogGuidelines: React.FC = () => (
  <ul className={listClassName}>
    <li>
      Required columns: SKU, Name, Cost, Barcode (<Chip>SKU</Chip>, <Chip>Name</Chip>,{' '}
      <Chip>Cost</Chip>, <Chip>Barcode</Chip>)
    </li>
    <li>
      Optional column: <Chip>Retail Price</Chip> (also accepts "Selling Price", "Sell Price", "RRP",
      "Sale Price") — enables retail-based markdown bands
    </li>
    <li>
      Column names are case-insensitive and can include common variations (e.g., "Product Name",
      "Item Name", "Item Cost", "Unit Cost")
    </li>
    <li>
      Cost and Retail format: Use decimal numbers like <Chip>1.99</Chip> or <Chip>19.99</Chip> (no
      currency symbols)
    </li>
  </ul>
);

export const FormatGuidelines = forwardRef<HTMLDivElement, { id: string; isExpiryImport: boolean }>(
  ({ id, isExpiryImport }, ref) => (
    <div id={id} ref={ref} className="mb-6 scroll-mt-4 p-4 bg-semantic-primary-muted rounded-md">
      <h2 className="text-lg font-medium text-semantic-primary-muted-foreground mb-2">
        Format Guidelines
      </h2>
      {isExpiryImport ? <ExpiryGuidelines /> : <CatalogGuidelines />}
    </div>
  ),
);
FormatGuidelines.displayName = 'FormatGuidelines';

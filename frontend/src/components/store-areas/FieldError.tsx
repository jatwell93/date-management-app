interface FieldErrorProps {
  id: string;
  show: boolean;
  children: React.ReactNode;
}

/** Inline validation message tied to its input through `aria-describedby={id}`. */
export function FieldError({ id, show, children }: FieldErrorProps) {
  if (!show) return null;
  return (
    <p id={id} className="text-sm text-semantic-critical-muted-foreground">
      {children}
    </p>
  );
}

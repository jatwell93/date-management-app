interface FieldErrorProps {
  id: string;
  children: React.ReactNode;
}

/** Inline validation message tied to its input through `aria-describedby={id}`. */
export function FieldError({ id, children }: FieldErrorProps) {
  return (
    <p id={id} className="text-sm text-semantic-critical-muted-foreground">
      {children}
    </p>
  );
}

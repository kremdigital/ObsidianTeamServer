'use client';

import { type ReactNode } from 'react';
import { Controller, useFormContext, type FieldValues, type Path } from 'react-hook-form';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

export interface FormFieldProps<T extends FieldValues> {
  name: Path<T>;
  label?: string;
  description?: string;
  className?: string;
  children: (field: {
    id: string;
    value: unknown;
    onChange: (value: unknown) => void;
    onBlur: () => void;
    name: string;
    'aria-invalid'?: boolean;
  }) => ReactNode;
}

export function FormField<T extends FieldValues>(props: FormFieldProps<T>) {
  const { name, label, description, className, children } = props;
  const { control, formState } = useFormContext<T>();

  const id = `field-${String(name)}`;
  const fieldState = formState.errors[name];
  const errorMessage = typeof fieldState?.message === 'string' ? fieldState.message : undefined;

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label && (
        <Label htmlFor={id} className="text-sm font-medium">
          {label}
        </Label>
      )}
      <Controller
        control={control}
        name={name}
        render={({ field }) =>
          children({
            id,
            value: field.value,
            onChange: field.onChange,
            onBlur: field.onBlur,
            name: field.name,
            ...(errorMessage ? { 'aria-invalid': true } : {}),
          }) as React.ReactElement
        }
      />
      {description && !errorMessage && (
        <p className="text-muted-foreground text-xs">{description}</p>
      )}
      {errorMessage && <p className="text-destructive text-xs">{errorMessage}</p>}
    </div>
  );
}

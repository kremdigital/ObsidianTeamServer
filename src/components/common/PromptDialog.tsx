'use client';

import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export interface PromptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  /** Начальное значение — для переименования это текущее имя. */
  initialValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Возвращает текст ошибки, если значение не годится, иначе null. */
  validate?: (value: string) => string | null;
  onSubmit: (value: string) => void | Promise<void>;
}

/**
 * Диалог ввода одной строки — пара к `ConfirmDialog`.
 *
 * Заведён вместо `window.prompt`: тот блокирует поток, не поддаётся оформлению
 * и не даёт показать ошибку валидации, не потеряв введённое.
 *
 * Поле вынесено во вложенный компонент: он монтируется только на открытом
 * диалоге, поэтому значение сбрасывается само. Иначе диалог, вызванный для
 * другого файла, показал бы прежнее имя.
 */
export function PromptDialog({ open, onOpenChange, ...rest }: PromptDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>{open && <PromptForm onOpenChange={onOpenChange} {...rest} />}</DialogContent>
    </Dialog>
  );
}

function PromptForm({
  onOpenChange,
  title,
  description,
  initialValue = '',
  placeholder,
  confirmLabel = 'Сохранить',
  cancelLabel = 'Отмена',
  validate,
  onSubmit,
}: Omit<PromptDialogProps, 'open'>) {
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (trimmed.length === 0) return;
    const problem = validate?.(trimmed) ?? null;
    if (problem !== null) {
      setError(problem);
      return;
    }
    setPending(true);
    try {
      await onSubmit(trimmed);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        {description && <DialogDescription>{description}</DialogDescription>}
      </DialogHeader>
      <div className="py-4">
        <Input
          autoFocus
          value={value}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
          aria-invalid={error ? true : undefined}
        />
        {error && <p className="text-destructive mt-2 text-sm">{error}</p>}
      </div>
      <DialogFooter className="gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => onOpenChange(false)}
          disabled={pending}
        >
          {cancelLabel}
        </Button>
        <Button type="submit" disabled={pending || value.trim().length === 0}>
          {confirmLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}

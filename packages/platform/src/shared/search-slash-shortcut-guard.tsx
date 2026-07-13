'use client';

import { useEffect } from 'react';

const INPUT_TYPES_THAT_ARE_NOT_TEXTUAL = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'hidden',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
]);

const isTextualInput = (el: HTMLInputElement) => {
  const type = (el.getAttribute('type') ?? 'text').toLowerCase();
  return !INPUT_TYPES_THAT_ARE_NOT_TEXTUAL.has(type);
};

const isEditableTarget = (target: EventTarget | null) => {
  if (!(target instanceof Element)) {
    return false;
  }

  if (target.closest('.monaco-editor')) {
    return true;
  }

  if (target.closest('[contenteditable="true"]')) {
    return true;
  }

  const el = target.closest('input, textarea, select');
  if (!el) {
    return false;
  }

  if (el instanceof HTMLTextAreaElement) {
    return true;
  }

  if (el instanceof HTMLInputElement) {
    return isTextualInput(el);
  }

  return el instanceof HTMLSelectElement;
};

export default function SearchSlashShortcutGuard() {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }

      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      if (!isEditableTarget(event.target)) {
        return;
      }

      event.stopPropagation();
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  return null;
}

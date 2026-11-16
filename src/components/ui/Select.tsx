import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Check, ChevronDown, Search } from 'lucide-react';
import { useAnchoredPopup } from '../../hooks/useAnchoredPopup';
import { cn } from '../../utils/format';
import {
  FieldMessage,
  FieldRequiredMark,
  fieldLabelClass,
  fieldShellClass,
} from './fieldStyles';

export interface SelectOption {
  value: string | number;
  label: string;
  disabled?: boolean;
}

export interface SelectProps {
  label?: string;
  error?: string;
  hint?: string;
  options?: SelectOption[];
  placeholder?: string;
  containerClassName?: string;
  searchable?: boolean;
  className?: string;
  id?: string;
  required?: boolean;
  disabled?: boolean;
  value?: string | number | readonly string[];
  name?: string;
  onChange?: (event: ChangeEvent<HTMLSelectElement>) => void;
  'data-testid'?: string;
  'aria-label'?: string;
}

function emitChange(
  onChange: SelectProps['onChange'],
  next: string,
  name?: string,
) {
  if (!onChange) return;
  onChange({
    target: { value: next, name: name ?? '' },
    currentTarget: { value: next, name: name ?? '' },
  } as ChangeEvent<HTMLSelectElement>);
}

const Select = function Select({
  label,
  error,
  hint,
  options = [],
  placeholder,
  className,
  containerClassName,
  id,
  required,
  disabled,
  value,
  name,
  searchable,
  onChange,
  'data-testid': testId,
  'aria-label': ariaLabel,
}: SelectProps) {
  const { t } = useTranslation();
  const generatedId = useId();
  const selectId = id ?? generatedId;
  const listId = `${selectId}-list`;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [focused, setFocused] = useState(false);

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  const current = value === undefined || value === null ? '' : String(value);
  const selected = options.find((option) => String(option.value) === current) ?? null;
  const labeled = Boolean(label);
  const float = labeled && (focused || open || current !== '' || Boolean(selected));

  const enableSearch = searchable ?? options.length >= 6;

  const visible = useMemo(() => {
    if (!enableSearch || !query.trim()) return options;
    const needle = query.trim().toLowerCase();
    return options.filter((option) => option.label.toLowerCase().includes(needle));
  }, [enableSearch, options, query]);

  const rows = useMemo(() => {
    const list: Array<SelectOption> = [];
    const hasEmpty = options.some((option) => String(option.value) === '');
    if (placeholder && !query.trim() && !hasEmpty) list.push({ value: '', label: placeholder });
    list.push(...visible);
    return list;
  }, [options, placeholder, query, visible]);

  const rect = useAnchoredPopup(open, triggerRef, 280);

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setActiveIndex(0);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (triggerRef.current?.contains(target)) return;
      if (popupRef.current?.contains(target)) return;
      close();
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
    };
  }, [close, open]);

  useEffect(() => {
    if (!open) return;
    if (enableSearch) searchRef.current?.focus();
    else triggerRef.current?.focus();
  }, [enableSearch, open]);

  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const node = listRef.current?.children[activeIndex] as HTMLElement | undefined;
    node?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  const openPopup = () => {
    if (disabled) return;
    setOpen(true);
    const selectedIndex = rows.findIndex((option) => String(option.value) === current);
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
  };

  const pick = (option: SelectOption) => {
    if (option.disabled) return;
    emitChange(onChange, String(option.value), name);
    close();
    triggerRef.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const inSearch = (event.target as HTMLElement | null)?.tagName === 'INPUT';
    if (event.key === 'Escape') {
      if (!open) return;
      event.stopPropagation();
      event.preventDefault();
      close();
      return;
    }
    if (!open) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        openPopup();
      }
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => (rows.length === 0 ? 0 : (index + 1) % rows.length));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => (rows.length === 0 ? 0 : (index - 1 + rows.length) % rows.length));
    } else if (event.key === 'Home' && !inSearch) {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === 'End' && !inSearch) {
      event.preventDefault();
      setActiveIndex(Math.max(0, rows.length - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const option = rows[activeIndex];
      if (option) pick(option);
    } else if (event.key === ' ' && !inSearch) {
      event.preventDefault();
      const option = rows[activeIndex];
      if (option) pick(option);
    } else if (event.key === 'Tab') {
      close();
    }
  };

  const display = selected?.label ?? (current === '' ? placeholder ?? '' : current);
  const empty = !selected && current === '';

  return (
    <div className={cn('w-full', containerClassName)}>
      {name ? <input type="hidden" name={name} value={current} /> : null}

      <div className={fieldShellClass({ error: Boolean(error), disabled, labeled })}>
        {label ? (
          <label
            htmlFor={selectId}
            className={fieldLabelClass({ float, error: Boolean(error), focused: focused || open })}
          >
            {label}
            {required ? <FieldRequiredMark /> : null}
          </label>
        ) : null}

        <button
          ref={triggerRef}
          id={selectId}
          type="button"
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-required={required || undefined}
          aria-invalid={!!error}
          aria-describedby={error ? `${selectId}-error` : hint ? `${selectId}-hint` : undefined}
          disabled={disabled}
          onClick={() => (open ? close() : openPopup())}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          data-testid={testId}
          aria-label={ariaLabel ?? label}
          className={cn(
            'flex h-full min-w-0 flex-1 items-center gap-2 bg-transparent text-start text-body focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0',
            labeled ? 'px-3.5 pb-[9px] pt-[22px]' : 'px-3.5',
            className,
          )}
        >
          <span
            className={cn(
              'min-w-0 flex-1 truncate',
              empty ? 'text-muted' : 'text-foreground',
              labeled && !float && 'opacity-0',
            )}
            dir="auto"
          >
            {display}
          </span>
          <ChevronDown
            className={cn(
              'h-4 w-4 shrink-0 text-muted transition-transform duration-200',
              open && 'rotate-180 text-primary',
            )}
            aria-hidden="true"
          />
        </button>
      </div>

      {open && rect
        ? createPortal(
            <div
              ref={popupRef}
              style={{
                position: 'fixed',
                top: rect.top,
                bottom: rect.bottom,
                left: rect.left,
                width: rect.width,
                maxHeight: rect.maxHeight,
                zIndex: rect.zIndex,
              }}
              data-placement={rect.placement}
              className="popup-enter flex flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white/95 shadow-[0_18px_50px_rgba(15,23,42,0.16)] backdrop-blur-md"
            >
              {enableSearch ? (
                <div className="relative border-b border-slate-100 p-2">
                  <Search
                    className="pointer-events-none absolute inset-y-0 start-4 my-auto h-3.5 w-3.5 text-muted"
                    aria-hidden="true"
                  />
                  <input
                    ref={searchRef}
                    type="search"
                    autoComplete="off"
                    value={query}
                    onChange={(event) => {
                      setQuery(event.target.value);
                      setActiveIndex(0);
                    }}
                    onKeyDown={onKeyDown}
                    placeholder={t('common.search')}
                    aria-label={t('common.search')}
                    aria-controls={listId}
                    className="h-9 w-full rounded-xl border border-slate-200/80 bg-slate-50 ps-8 pe-3 text-[13px] text-foreground placeholder:text-muted/70 focus:border-primary/60 focus:bg-white focus:outline-none"
                  />
                </div>
              ) : null}

              <ul
                ref={listRef}
                id={listId}
                role="listbox"
                tabIndex={-1}
                className="min-h-0 flex-1 overflow-y-auto p-1.5"
              >
                {rows.length === 0 ? (
                  <li className="px-3 py-2.5 text-[13px] text-muted">{t('common.noOptions')}</li>
                ) : (
                  rows.map((option, index) => {
                    const optionValue = String(option.value);
                    const isSelected = optionValue === current;
                    const isActive = index === activeIndex;
                    const isPlaceholder = optionValue === '' && option.label === placeholder;
                    return (
                      <li key={`${optionValue}-${index}`} role="none">
                        <button
                          type="button"
                          role="option"
                          aria-selected={isSelected}
                          disabled={option.disabled}
                          onMouseEnter={() => setActiveIndex(index)}
                          onClick={() => pick(option)}
                          className={cn(
                            'flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-start text-[13px] transition-colors',
                            isActive && 'bg-slate-50',
                            isSelected && 'bg-primary/[0.07] font-medium text-primary',
                            isPlaceholder && !isSelected && 'text-muted',
                            option.disabled && 'cursor-not-allowed opacity-40',
                          )}
                        >
                          <span className="min-w-0 flex-1 truncate" dir="auto">
                            {option.label}
                          </span>
                          {isSelected ? (
                            <Check className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                          ) : null}
                        </button>
                      </li>
                    );
                  })
                )}
              </ul>
            </div>,
            document.body,
          )
        : null}

      <FieldMessage id={selectId} error={error} hint={hint} />
    </div>
  );
};

export default Select;

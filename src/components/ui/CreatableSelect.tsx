import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Check, ChevronDown, Loader2, Plus, Search, X } from 'lucide-react';
import { cn } from '../../utils/format';

/** Height of the popup ceiling, in pixels. */
const MAX_POPUP_HEIGHT = 264;
/** Space kept between the trigger and the viewport edges. */
const VIEWPORT_MARGIN = 8;

export interface CreatableSelectProps<T> {
  options: T[];
  value: T | null;
  onChange: (value: T | null) => void;
  getOptionLabel: (option: T) => string;
  getOptionValue: (option: T) => string | number;

  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  containerClassName?: string;
  label?: string;
  error?: string;
  hint?: string;

  /** Opens the quick-create modal. Always rendered as the last row. */
  onCreate: () => void;
  createLabel?: string;
  /** Shows a spinner instead of the create label. */
  isCreating?: boolean;

  /** Adds a search field at the top of the popup. */
  searchable?: boolean;
  searchPlaceholder?: string;
  /**
   * Server-side search: when provided, typing calls this instead of filtering
   * the options locally (the popup then shows exactly what the caller loaded).
   */
  onSearch?: (query: string) => void;

  /** Renders like a plain `Select`, without the create row (nesting guard). */
  disableCreate?: boolean;
  /** Allows clearing the value back to `null` (optional reference fields). */
  clearable?: boolean;
  emptyLabel?: string;
  /** Secondary line under an option label (level, phone, …). */
  renderOption?: (option: T) => ReactNode;

  /** Base of every `data-testid`: `-trigger`, `-list`, `-option-<value>`, `-create`. */
  testId?: string;
}

/**
 * A select whose list ends with a **“+ Nouveau…”** row.
 *
 * Native `<select>` cannot carry an action that is not a value, and the app
 * needs one on every dropdown that points at another entity (teacher, subject,
 * level, group, student, expense category). This is that dropdown: a button
 * trigger, a portal popup (so a modal's `overflow-y-auto` cannot clip it), full
 * keyboard support, an optional search field, and the create row pinned last.
 *
 * The popup lives in a portal positioned from the trigger's rectangle: the modal
 * body scrolls, and an absolutely positioned list would be cut at its edge.
 */
export function CreatableSelect<T>({
  options,
  value,
  onChange,
  getOptionLabel,
  getOptionValue,
  placeholder,
  disabled = false,
  required = false,
  className,
  containerClassName,
  label,
  error,
  hint,
  onCreate,
  createLabel,
  isCreating = false,
  searchable = false,
  searchPlaceholder,
  onSearch,
  disableCreate = false,
  clearable = false,
  emptyLabel,
  renderOption,
  testId,
}: CreatableSelectProps<T>) {
  const { t } = useTranslation();
  const generatedId = useId();
  const triggerId = `creatable-${generatedId}`;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  const searchableFinal = searchable || Boolean(onSearch);
  const canCreate = !disableCreate;

  /** Options actually shown: filtered locally unless the caller searches. */
  const visible = useMemo(() => {
    if (!searchableFinal || onSearch || !query.trim()) return options;
    const needle = query.trim().toLowerCase();
    return options.filter((option) => getOptionLabel(option).toLowerCase().includes(needle));
  }, [getOptionLabel, onSearch, options, query, searchableFinal]);

  /** Number of selectable rows, create row included. */
  const rowCount = visible.length + (canCreate ? 1 : 0);
  const createIndex = visible.length;

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setActiveIndex(-1);
  }, []);

  /** Recompute the popup rectangle (called on open, scroll and resize). */
  const measure = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const box = trigger.getBoundingClientRect();
    const spaceBelow = window.innerHeight - box.bottom - VIEWPORT_MARGIN;
    const spaceAbove = box.top - VIEWPORT_MARGIN;
    // Flip above when the list would not fit below but fits above.
    const placeAbove = spaceBelow < Math.min(MAX_POPUP_HEIGHT, 180) && spaceAbove > spaceBelow;
    const height = Math.min(MAX_POPUP_HEIGHT, placeAbove ? spaceAbove : spaceBelow);
    setRect({
      top: placeAbove ? box.top - height : box.bottom + 4,
      left: box.left,
      width: box.width,
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setRect(null);
      return;
    }
    measure();
    const onScrollOrResize = () => measure();
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [measure, open]);

  // Click outside closes (the popup is a portal, so it is not a DOM child).
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

  // The search field takes the focus as soon as the popup opens.
  useEffect(() => {
    if (!open) return;
    if (searchableFinal) searchRef.current?.focus();
    else triggerRef.current?.focus();
  }, [open, searchableFinal]);

  // Keep the highlighted row visible while arrowing through a long list.
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const list = listRef.current;
    const node = list?.children[activeIndex] as HTMLElement | undefined;
    node?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  const openPopup = useCallback(() => {
    if (disabled) return;
    setOpen(true);
    const selectedIndex = options.findIndex(
      (option) => value !== null && String(getOptionValue(option)) === String(getOptionValue(value)),
    );
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : rowCount > 0 ? 0 : -1);
  }, [disabled, getOptionValue, options, rowCount, value]);

  const selectOption = useCallback(
    (option: T) => {
      onChange(option);
      close();
    },
    [close, onChange],
  );

  const activateRow = useCallback(
    (index: number) => {
      if (index >= 0 && index < visible.length) selectOption(visible[index]);
      else if (canCreate && index === createIndex) {
        close();
        onCreate();
      }
    },
    [canCreate, close, createIndex, onCreate, selectOption, visible],
  );

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (event.key === 'Escape') {
        if (!open) return;
        event.stopPropagation();
        event.preventDefault();
        close();
        return;
      }
      if (!open) {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openPopup();
        }
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((index) => (rowCount === 0 ? -1 : (index + 1 + rowCount) % rowCount));
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((index) => (rowCount === 0 ? -1 : (index - 1 + rowCount) % rowCount));
      } else if (event.key === 'Home') {
        event.preventDefault();
        setActiveIndex(rowCount > 0 ? 0 : -1);
      } else if (event.key === 'End') {
        event.preventDefault();
        setActiveIndex(rowCount - 1);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        activateRow(activeIndex);
      } else if (event.key === 'Tab') {
        close();
      }
    },
    [activateRow, activeIndex, close, open, openPopup, rowCount],
  );

  const selectedLabel = value !== null ? getOptionLabel(value) : '';
  const listId = `${triggerId}-list`;

  return (
    <div className={cn('w-full', containerClassName)} data-testid={testId}>
      {label && (
        <label htmlFor={triggerId} className="mb-1.5 block text-label text-muted">
          {label}
          {required && <span className="ms-0.5 text-red-500" aria-hidden="true">*</span>}
        </label>
      )}

      <div className="relative">
        <button
          ref={triggerRef}
          id={triggerId}
          type="button"
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-required={required || undefined}
          aria-invalid={!!error}
          aria-describedby={error ? `${triggerId}-error` : hint ? `${triggerId}-hint` : undefined}
          disabled={disabled}
          onClick={() => (open ? close() : openPopup())}
          onKeyDown={onKeyDown}
          data-testid={testId ? `${testId}-trigger` : undefined}
          className={cn(
            'flex min-h-9 w-full items-center gap-2 rounded-md border bg-white px-3 py-1.5 text-start text-body',
            'focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20',
            'disabled:cursor-not-allowed disabled:bg-background disabled:text-muted',
            error ? 'border-destructive' : 'border-border',
            className,
          )}
        >
          <span
            className={cn('min-w-0 flex-1', value === null ? 'whitespace-normal break-words text-muted' : 'truncate text-foreground')}
            dir="auto"
          >
            {value === null ? (placeholder ?? '') : selectedLabel}
          </span>

          {clearable && value !== null && !disabled ? (
            <span
              role="button"
              tabIndex={-1}
              aria-label={t('common.clear')}
              onClick={(event) => {
                event.stopPropagation();
                onChange(null);
                close();
              }}
              className="rounded p-0.5 text-muted transition-colors hover:bg-background hover:text-foreground"
              data-testid={testId ? `${testId}-clear` : undefined}
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
          ) : null}

          <ChevronDown
            className={cn('h-4 w-4 shrink-0 text-muted transition-transform', open && 'rotate-180')}
            aria-hidden="true"
          />
        </button>

        {open && rect
          ? createPortal(
              <div
                ref={popupRef}
                style={{
                  position: 'fixed',
                  top: rect.top,
                  left: rect.left,
                  width: rect.width,
                  maxHeight: MAX_POPUP_HEIGHT,
                }}
                className="popup-enter z-[60] flex flex-col overflow-hidden rounded-md border border-border bg-white shadow-lg"
                data-testid={testId ? `${testId}-list` : undefined}
              >
                {searchableFinal ? (
                  <div className="relative border-b border-border p-2">
                    <Search
                      className="pointer-events-none absolute inset-y-0 start-4 my-auto h-3.5 w-3.5 text-muted"
                      aria-hidden="true"
                    />
                    <input
                      ref={searchRef}
                      type="search"
                      value={query}
                      onChange={(event) => {
                        setQuery(event.target.value);
                        setActiveIndex(event.target.value ? 0 : -1);
                        onSearch?.(event.target.value);
                      }}
                      onKeyDown={onKeyDown}
                      placeholder={searchPlaceholder ?? t('common.search')}
                      aria-label={searchPlaceholder ?? t('common.search')}
                      aria-controls={listId}
                      className="h-8 w-full rounded border border-border bg-white ps-8 pe-2 text-[13px] text-foreground placeholder:text-muted/70 focus:border-primary focus:outline-none"
                      data-testid={testId ? `${testId}-search` : undefined}
                    />
                  </div>
                ) : null}

                <ul
                  ref={listRef}
                  id={listId}
                  role="listbox"
                  tabIndex={-1}
                  className="min-h-0 flex-1 overflow-y-auto py-1"
                >
                  {visible.length === 0 ? (
                    <li className="px-3 py-2 text-[13px] text-muted" data-testid={testId ? `${testId}-empty` : undefined}>
                      {emptyLabel ?? t('common.noOptions')}
                    </li>
                  ) : (
                    visible.map((option, index) => {
                      const optionValue = String(getOptionValue(option));
                      const isSelected =
                        value !== null && String(getOptionValue(value)) === optionValue;
                      const isActive = index === activeIndex;
                      return (
                        <li key={optionValue} role="none">
                          <button
                            type="button"
                            role="option"
                            aria-selected={isSelected}
                            onMouseEnter={() => setActiveIndex(index)}
                            onClick={() => selectOption(option)}
                            data-testid={testId ? `${testId}-option-${optionValue}` : undefined}
                            data-value={optionValue}
                            className={cn(
                              'flex w-full items-center gap-2 px-3 py-1.5 text-start text-[13px] transition-colors',
                              isActive ? 'bg-primary/5' : 'bg-transparent',
                              isSelected ? 'font-medium text-primary' : 'text-foreground',
                            )}
                          >
                            <span className="min-w-0 flex-1" dir="auto">
                              <span className="block truncate">{getOptionLabel(option)}</span>
                              {renderOption ? (
                                <span className="mt-0.5 block truncate text-[11px] font-normal text-muted">
                                  {renderOption(option)}
                                </span>
                              ) : null}
                            </span>
                            {isSelected ? (
                              <Check className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                            ) : null}
                          </button>
                        </li>
                      );
                    })
                  )}
                  {canCreate ? (
                    // Sticky: a long list scrolls under it, the create row never leaves.
                    <li
                      role="none"
                      className="sticky bottom-0 mt-1 border-t border-border bg-white pt-1"
                    >
                      <button
                        type="button"
                        onMouseEnter={() => setActiveIndex(createIndex)}
                        onClick={() => {
                          close();
                          onCreate();
                        }}
                        disabled={isCreating}
                        data-testid={testId ? `${testId}-create` : undefined}
                        className={cn(
                          'flex w-full items-center gap-2 px-3 py-2 text-start text-[13px] font-medium text-primary transition-colors hover:bg-primary/5',
                          activeIndex === createIndex && 'bg-primary/5',
                          isCreating && 'opacity-70',
                        )}
                      >
                        {isCreating ? (
                          <>
                            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                            <span>{t('common.creating')}</span>
                          </>
                        ) : (
                          <>
                            <Plus className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                            <span>{createLabel ?? t('common.createNew')}</span>
                          </>
                        )}
                      </button>
                    </li>
                  ) : null}
                </ul>
              </div>,
              document.body,
            )
          : null}
      </div>

      {error ? (
        <p id={`${triggerId}-error`} className="mt-1 text-[13px] text-destructive" data-testid={testId ? `${testId}-error` : undefined}>
          {error}
        </p>
      ) : hint ? (
        <p id={`${triggerId}-hint`} className="mt-1 text-[13px] text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export default CreatableSelect;

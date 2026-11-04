import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import CreatableSelect, { type CreatableSelectProps } from './CreatableSelect';

/** Adds a query-aware create label without coupling the generic select to any modal. */
export default function CreatableEntitySelect<T>({ options, onSearch, onChange, onCreate, getOptionLabel, disableCreate, createLabel, ...props }: CreatableSelectProps<T>) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const wrapperRef = useRef<HTMLDivElement>(null);
  // The generic select portals its popup to body. Keep each popup just above
  // its own modal, but below any subsequently opened child modal.
  useEffect(() => {
    const syncPopupLayer = () => {
      const wrapper = wrapperRef.current;
      const trigger = wrapper?.querySelector('[role="combobox"]');
      const listId = trigger?.getAttribute('aria-controls');
      const popup = listId ? document.getElementById(listId)?.closest<HTMLElement>('.popup-enter') : null;
      const modal = wrapper?.closest<HTMLElement>('[data-modal-z]');
      if (popup && modal) popup.style.zIndex = String(Number(modal.dataset.modalZ) + 1);
    };
    const observer = new window.MutationObserver(syncPopupLayer);
    observer.observe(document.body, { childList: true });
    return () => observer.disconnect();
  }, []);
  const text = query.trim();
  const lower = text.toLocaleLowerCase();
  const matches = onSearch || !lower ? options : options.filter(option => getOptionLabel(option).toLocaleLowerCase().includes(lower));
  const exact = Boolean(lower && options.some(option => getOptionLabel(option).trim().toLocaleLowerCase() === lower));
  const resetOnOpen = (target: EventTarget | null) => {
    const trigger = target instanceof window.Element ? target.closest('[role="combobox"]') : null;
    if (trigger?.getAttribute('aria-expanded') === 'false') { setQuery(''); onSearch?.(''); }
  };
  return <div ref={wrapperRef} onClickCapture={event => resetOnOpen(event.target)} onKeyDownCapture={event => {
    if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(event.key)) resetOnOpen(event.target);
  }}>
    <CreatableSelect {...props} options={matches} searchable getOptionLabel={getOptionLabel}
      onSearch={value => { setQuery(value); onSearch?.(value); }}
      onChange={value => { setQuery(''); onChange(value); }}
      onCreate={() => { setQuery(''); onCreate(); }}
      disableCreate={disableCreate || exact}
      createLabel={text ? `${t('common.create')} « ${text} »` : createLabel} />
  </div>;
}

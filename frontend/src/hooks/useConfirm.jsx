import { useState, useCallback, useRef } from 'react';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';

export function useConfirm() {
  const [state, setState] = useState(null);
  const resolver = useRef(null);

  const confirm = useCallback((message, options = {}) => {
    return new Promise((resolve) => {
      resolver.current = resolve;
      setState({ message, ...options });
    });
  }, []);

  function settle(value) {
    const resolve = resolver.current;
    resolver.current = null;
    setState(null);
    if (resolve) resolve(value);
  }

  const confirmDialog = (
    <ConfirmDialog
      open={Boolean(state)}
      message={state?.message}
      danger={state?.danger}
      confirmLabel={state?.confirmLabel}
      cancelLabel={state?.cancelLabel}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  );

  return { confirm, confirmDialog };
}

import React, { createContext, useContext, ReactNode } from 'react';
import { useDialog } from '@/hooks/useDialog';

type DialogContextType = ReturnType<typeof useDialog>;

const DialogContext = createContext<DialogContextType | null>(null);

export function DialogProvider({ children }: { children: ReactNode }) {
  const dialogState = useDialog();

  return (
    <DialogContext.Provider value={dialogState}>
      {children}
    </DialogContext.Provider>
  );
}

export function useDialogContext() {
  const context = useContext(DialogContext);
  if (!context) {
    throw new Error('useDialogContext must be used within a DialogProvider');
  }
  return context;
} 
import { createContext } from 'react';
export const TagNavigation = createContext<((tag: string) => void) | undefined>(undefined);

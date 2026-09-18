import { createContext } from 'react';
import type { PluginCompletionInvoke } from './pluginTypes';

export const PluginCompletionContext = createContext<PluginCompletionInvoke | undefined>(undefined);

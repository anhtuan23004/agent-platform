import { type NavManifest, noNavExtensions } from '@seta/module-sdk';
import { Box } from 'lucide-react';

export const pmoNavManifest: NavManifest = {
  id: 'pmo',
  label: 'Pmo',
  icon: Box,
  requiredPermissions: [],
  useNavExtensions: noNavExtensions,
  nav: [
    {
      label: 'Pmo',
      items: [{ id: 'pmo.home', icon: Box, label: 'Pmo', to: '/pmo' }],
    },
  ],
};

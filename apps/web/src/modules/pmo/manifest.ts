import { type NavManifest, noNavExtensions } from '@seta/module-sdk';
import { Box, Calculator, MessageSquare } from 'lucide-react';

export const pmoNavManifest: NavManifest = {
  id: 'pmo',
  label: 'Pmo',
  icon: Box,
  requiredPermissions: ['pmo.data.read'],
  useNavExtensions: noNavExtensions,
  nav: [
    {
      label: 'Pmo',
      items: [
        { id: 'pmo.home', icon: Box, label: 'Overview', to: '/pmo' },
        {
          id: 'pmo.demo-calculation',
          icon: Calculator,
          label: 'Utilization',
          to: '/pmo/demo-calculation',
        },
        { id: 'pmo.agent', icon: MessageSquare, label: 'PMO Agent', to: '/pmo/agent' },
      ],
    },
  ],
};

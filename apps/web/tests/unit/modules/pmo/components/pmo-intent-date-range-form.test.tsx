import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { IntentResolutionOptions } from '../../../../../src/modules/pmo/components/pmo-workflow-cards-section';

describe('IntentResolutionOptions', () => {
  const options = [
    {
      id: 'report_existing_db' as const,
      label: 'Report from existing data',
      description: 'Use canonical PMO data.',
      dataSourceMode: 'existing_db' as const,
      actionMode: 'generate_report' as const,
    },
    {
      id: 'publish_then_report' as const,
      label: 'Publish, then report',
      description: 'Publish approved changes first.',
      dataSourceMode: 'uploaded_file' as const,
      actionMode: 'publish_then_report' as const,
    },
  ];

  it('confirms selected multi-axis scope', () => {
    const onConfirm = vi.fn();
    render(
      <IntentResolutionOptions options={options} isSubmitting={false} onConfirm={onConfirm} />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Publish, then report/ }));

    expect(onConfirm).toHaveBeenCalledWith({
      dataSourceMode: 'uploaded_file',
      actionMode: 'publish_then_report',
    });
  });
});

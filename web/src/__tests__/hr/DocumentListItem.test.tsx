import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { DocumentListItem } from '@/components/hr/DocumentListItem';
import type { EmployeeDocument } from '@/lib/validations/employee';

const baseDocument: EmployeeDocument = {
  id: 'doc-1',
  title: 'Passport Copy',
  category: 'id_proof',
  file_name: 'passport.pdf',
  file_size: 524288,
  mime_type: 'application/pdf',
  expiry_date: null,
  is_verified: false,
  verified_by: null,
  verified_at: null,
  uploaded_by: { id: 'user-1', name: 'John Doe' },
  notes: null,
  download_url: 'https://example.com/download/passport.pdf',
  created_at: '2024-01-15T00:00:00.000000Z',
};

describe('DocumentListItem', () => {
  it('renders title, category, and file name', () => {
    render(
      <DocumentListItem
        document={baseDocument}
        canVerify={false}
        canDelete={false}
      />
    );

    expect(screen.getByText('Passport Copy')).toBeInTheDocument();
    expect(screen.getByText('ID Proof')).toBeInTheDocument();
    expect(screen.getByText('passport.pdf')).toBeInTheDocument();
  });

  it('shows file size', () => {
    render(
      <DocumentListItem
        document={baseDocument}
        canVerify={false}
        canDelete={false}
      />
    );

    expect(screen.getByText('512.0 KB')).toBeInTheDocument();
  });

  it('shows no expiry badge when expiry_date is null', () => {
    render(
      <DocumentListItem
        document={baseDocument}
        canVerify={false}
        canDelete={false}
      />
    );

    expect(screen.queryByText(/Expired/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Expires/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Valid until/i)).not.toBeInTheDocument();
  });

  it('shows "Expired" badge when document is expired', () => {
    const doc = { ...baseDocument, expiry_date: '2020-01-01' };
    render(
      <DocumentListItem document={doc} canVerify={false} canDelete={false} />
    );

    const expiredBadge = screen.getByText('Expired');
    expect(expiredBadge).toBeInTheDocument();
    expect(expiredBadge.className).toContain('bg-red-100');
  });

  it('shows "Expires" badge when expiring within 30 days', () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 15);
    const doc = {
      ...baseDocument,
      expiry_date: futureDate.toISOString().split('T')[0],
    };
    render(
      <DocumentListItem document={doc} canVerify={false} canDelete={false} />
    );

    const expiringBadge = screen.getByText(/Expires/);
    expect(expiringBadge).toBeInTheDocument();
    expect(expiringBadge.className).toContain('bg-amber-100');
  });

  it('shows "Valid until" badge when not expiring soon', () => {
    const futureDate = new Date();
    futureDate.setFullYear(futureDate.getFullYear() + 2);
    const doc = {
      ...baseDocument,
      expiry_date: futureDate.toISOString().split('T')[0],
    };
    render(
      <DocumentListItem document={doc} canVerify={false} canDelete={false} />
    );

    const validBadge = screen.getByText(/Valid until/);
    expect(validBadge).toBeInTheDocument();
    expect(validBadge.className).toContain('bg-green-100');
  });

  it('shows verified badge when document is verified', () => {
    const doc = {
      ...baseDocument,
      is_verified: true,
      verified_by: { id: 'admin-1', name: 'Admin User' },
      verified_at: '2024-02-01T10:00:00.000000Z',
    };
    render(
      <DocumentListItem document={doc} canVerify={false} canDelete={false} />
    );

    expect(screen.getByLabelText('Verified')).toBeInTheDocument();
  });

  it('shows download button always', () => {
    render(
      <DocumentListItem
        document={baseDocument}
        canVerify={false}
        canDelete={false}
      />
    );

    const downloadLink = screen.getByLabelText('Download Passport Copy');
    expect(downloadLink).toBeInTheDocument();
    expect(downloadLink).toHaveAttribute(
      'href',
      'https://example.com/download/passport.pdf'
    );
  });

  it('shows verify button when canVerify is true and document is not verified', () => {
    const onVerify = vi.fn();
    render(
      <DocumentListItem
        document={baseDocument}
        canVerify={true}
        canDelete={false}
        onVerify={onVerify}
      />
    );

    expect(
      screen.getByLabelText('Verify Passport Copy')
    ).toBeInTheDocument();
  });

  it('hides verify button when document is already verified', () => {
    const doc = { ...baseDocument, is_verified: true };
    render(
      <DocumentListItem
        document={doc}
        canVerify={true}
        canDelete={false}
        onVerify={vi.fn()}
      />
    );

    expect(
      screen.queryByLabelText('Verify Passport Copy')
    ).not.toBeInTheDocument();
  });

  it('shows delete button when canDelete is true', () => {
    render(
      <DocumentListItem
        document={baseDocument}
        canVerify={false}
        canDelete={true}
        onDelete={vi.fn()}
      />
    );

    expect(
      screen.getByLabelText('Delete Passport Copy')
    ).toBeInTheDocument();
  });

  it('hides delete button when canDelete is false', () => {
    render(
      <DocumentListItem
        document={baseDocument}
        canVerify={false}
        canDelete={false}
      />
    );

    expect(
      screen.queryByLabelText('Delete Passport Copy')
    ).not.toBeInTheDocument();
  });

  it('calls onDelete when delete button is clicked', async () => {
    const onDelete = vi.fn();
    render(
      <DocumentListItem
        document={baseDocument}
        canVerify={false}
        canDelete={true}
        onDelete={onDelete}
      />
    );

    await userEvent.click(
      screen.getByLabelText('Delete Passport Copy')
    );
    expect(onDelete).toHaveBeenCalledWith('doc-1');
  });
});

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MembersPage } from './MembersPage';

const mockGet = vi.fn();

vi.mock('@services/api', () => ({
  default: {
    get: (...args: any[]) => mockGet(...args),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MembersPage />
    </QueryClientProvider>,
  );
}

describe('MembersPage', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockGet.mockResolvedValue({
      data: {
        data: [
          { id: 'm1', firstName: 'Rohit', lastName: 'Sharma', mobile: '+919876543210', memberCode: 'IRON-000001', status: 'ACTIVE' },
        ],
        meta: { total: 1, page: 1, totalPages: 1 },
      },
    });
  });

  it('renders the member list from the API', async () => {
    renderPage();
    expect(await screen.findByText('Rohit Sharma')).toBeInTheDocument();
    expect(screen.getByText('IRON-000001')).toBeInTheDocument();
  });

  it('opens the registration dialog when "Add Member" is clicked', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Rohit Sharma');

    await user.click(screen.getByRole('button', { name: /add member/i }));

    expect(await screen.findByText('Register New Member')).toBeInTheDocument();
  });
});

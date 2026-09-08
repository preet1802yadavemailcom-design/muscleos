import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { DashboardDrillDownDialog } from './DashboardDrillDownDialog';

const mockGet = vi.fn();
const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('@services/api', () => ({
  default: {
    get: (...args: any[]) => mockGet(...args),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

function renderDialog(metric: any = 'ACTIVE_MEMBERS', open = true) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onOpenChange = vi.fn();
  const res = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <DashboardDrillDownDialog
          open={open}
          onOpenChange={onOpenChange}
          metric={metric}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...res, onOpenChange };
}

describe('DashboardDrillDownDialog', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockNavigate.mockReset();
  });

  it('renders active members when metric is ACTIVE_MEMBERS', async () => {
    mockGet.mockResolvedValue({
      data: {
        data: [
          {
            id: 'm-1',
            firstName: 'Aarav',
            lastName: 'Patel',
            mobile: '+919988776655',
            memberCode: 'IRON-0001',
            status: 'ACTIVE',
            currentMembership: { planName: 'Annual Gold' },
          },
        ],
        total: 1,
        page: 1,
        limit: 10,
        totalPages: 1,
      },
    });

    renderDialog('ACTIVE_MEMBERS');

    expect(screen.getByText('Active Members')).toBeInTheDocument();
    expect(await screen.findByText('Aarav Patel')).toBeInTheDocument();
    expect(screen.getByText('IRON-0001')).toBeInTheDocument();
    expect(screen.getByText('+919988776655')).toBeInTheDocument();
    expect(screen.getByText('Annual Gold')).toBeInTheDocument();
  });

  it('renders inactive members when metric is INACTIVE_MEMBERS', async () => {
    mockGet.mockResolvedValue({
      data: {
        data: [
          {
            id: 'm-inactive-1',
            firstName: 'Neha',
            lastName: 'Sharma',
            mobile: '+919811223344',
            memberCode: 'IRON-0099',
            status: 'INACTIVE',
          },
        ],
        total: 1,
        page: 1,
        limit: 10,
        totalPages: 1,
      },
    });

    renderDialog('INACTIVE_MEMBERS');

    expect(screen.getByText('Inactive Members')).toBeInTheDocument();
    expect(await screen.findByText('Neha Sharma')).toBeInTheDocument();
    expect(screen.getByText('IRON-0099')).toBeInTheDocument();
  });

  it('renders check-ins when metric is CHECKINS_TODAY', async () => {
    mockGet.mockResolvedValue({
      data: {
        data: [
          {
            id: 'att-1',
            checkInAt: new Date().toISOString(),
            checkOutAt: null,
            durationMinutes: null,
            status: 'OPEN',
            member: {
              id: 'm-2',
              firstName: 'Priya',
              lastName: 'Singh',
              mobile: '+919876543210',
              memberCode: 'IRON-0002',
            },
          },
        ],
        total: 1,
        page: 1,
        limit: 10,
        totalPages: 1,
      },
    });

    renderDialog('CHECKINS_TODAY');

    expect(screen.getByText("Today's Check-ins")).toBeInTheDocument();
    expect(await screen.findByText('Priya Singh')).toBeInTheDocument();
    expect(screen.getByText('In Gym')).toBeInTheDocument();
  });

  it('renders revenue records when metric is REVENUE_TODAY', async () => {
    mockGet.mockResolvedValue({
      data: {
        data: [
          {
            id: 'pay-1',
            amount: 2500,
            currency: 'INR',
            gateway: 'UPI',
            status: 'COMPLETED',
            paidAt: new Date().toISOString(),
            member: {
              id: 'm-3',
              firstName: 'Vikram',
              lastName: 'Rathore',
              mobile: '+919123456780',
              memberCode: 'IRON-0003',
            },
          },
        ],
        total: 1,
        page: 1,
        limit: 10,
        totalPages: 1,
      },
    });

    renderDialog('REVENUE_TODAY');

    expect(screen.getByText("Today's Revenue")).toBeInTheDocument();
    expect(await screen.findByText('Vikram Rathore')).toBeInTheDocument();
    expect(screen.getByText('₹2,500')).toBeInTheDocument();
  });

  it('shows empty state and 0 records when total is 0', async () => {
    mockGet.mockResolvedValue({
      data: {
        data: [],
        total: 0,
        page: 1,
        limit: 10,
        totalPages: 0,
      },
    });

    renderDialog('EXPIRING_SOON');

    expect(await screen.findByText('No records found')).toBeInTheDocument();
    expect(screen.getAllByText(/0 records/i).length).toBeGreaterThan(0);
  });

  it('navigates to member profile when a member row is clicked', async () => {
    const user = userEvent.setup();
    mockGet.mockResolvedValue({
      data: {
        data: [
          {
            id: 'm-click-1',
            firstName: 'Rahul',
            lastName: 'Verma',
            mobile: '+919876540000',
            memberCode: 'MOS-0042',
            status: 'ACTIVE',
          },
        ],
        total: 1,
        page: 1,
        limit: 10,
        totalPages: 1,
      },
    });

    const { onOpenChange } = renderDialog('ACTIVE_MEMBERS');

    expect(await screen.findByText('Rahul Verma')).toBeInTheDocument();
    await user.click(screen.getByText('Rahul Verma'));

    expect(mockNavigate).toHaveBeenCalledWith('/members/m-click-1');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('shows error state and retries on failure', async () => {
    mockGet.mockRejectedValueOnce(new Error('Network error'));

    renderDialog('CURRENTLY_IN_GYM');

    expect(await screen.findByText('Failed to load drill-down records')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });
});

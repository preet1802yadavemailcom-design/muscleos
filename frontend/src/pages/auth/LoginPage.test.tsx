import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import { LoginPage } from './LoginPage';

vi.mock('@services/api', () => ({
  default: { post: vi.fn().mockRejectedValue({ response: { data: { message: 'Invalid credentials' } } }) },
}));

vi.mock('@store/auth.store', () => ({
  useAuthStore: () => ({ setAuth: vi.fn() }),
}));

function renderLoginPage() {
  return render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>,
  );
}

describe('LoginPage', () => {
  it('renders the MuscleOS branding and login fields', () => {
    renderLoginPage();
    expect(screen.getByText('MuscleOS')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('admin@gym.com')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });

  it('shows validation errors for an invalid email and short password', async () => {
    const user = userEvent.setup();
    renderLoginPage();

    await user.type(screen.getByPlaceholderText('admin@gym.com'), 'not-an-email');
    await user.type(screen.getByPlaceholderText('••••••••'), '123');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByText('Invalid email address')).toBeInTheDocument();
      expect(screen.getByText('Password must be at least 6 characters')).toBeInTheDocument();
    });
  });

  it('surfaces an API error message on failed login', async () => {
    const user = userEvent.setup();
    renderLoginPage();

    await user.type(screen.getByPlaceholderText('admin@gym.com'), 'owner@gym.com');
    await user.type(screen.getByPlaceholderText('••••••••'), 'Password123');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByText('Invalid credentials')).toBeInTheDocument();
  });
});

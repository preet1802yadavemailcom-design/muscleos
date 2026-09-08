import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PhoneLink } from './PhoneLink';

describe('PhoneLink Component', () => {
  it('renders a fallback dash when phone is missing or empty', () => {
    const { container } = render(<PhoneLink phone="" />);
    expect(container.textContent).toBe('—');
  });

  it('renders tel link and whatsapp link for valid 10-digit number', () => {
    render(<PhoneLink phone="9876543210" />);
    const telLink = screen.getByRole('link', { name: /Call 9876543210/i });
    expect(telLink).toBeInTheDocument();
    expect(telLink).toHaveAttribute('href', 'tel:9876543210');

    const waLink = screen.getByRole('link', { name: /WhatsApp message 9876543210/i });
    expect(waLink).toBeInTheDocument();
    expect(waLink).toHaveAttribute('href', 'https://wa.me/919876543210');
  });

  it('stops click propagation when link is clicked', () => {
    const parentClick = vi.fn();
    render(
      <div onClick={parentClick}>
        <PhoneLink phone="9876543210" />
      </div>
    );
    const telLink = screen.getByRole('link', { name: /Call 9876543210/i });
    fireEvent.click(telLink);
    expect(parentClick).not.toHaveBeenCalled();
  });
});

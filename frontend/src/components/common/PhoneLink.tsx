import { Phone, MessageSquare } from 'lucide-react';

interface PhoneLinkProps {
  phone?: string | null;
  className?: string;
  showWhatsApp?: boolean;
  showIcon?: boolean;
  iconClassName?: string;
}

export function PhoneLink({
  phone,
  className = '',
  showWhatsApp = true,
  showIcon = false,
  iconClassName = 'h-3.5 w-3.5',
}: PhoneLinkProps) {
  if (!phone || !phone.trim()) {
    return <span className="text-muted-foreground">—</span>;
  }

  const raw = phone.trim();
  const cleanDigits = raw.replace(/\D/g, '');
  const waDigits = cleanDigits.length === 10 ? `91${cleanDigits}` : cleanDigits;

  return (
    <span
      className={`inline-flex items-center gap-1.5 ${className}`}
      onClick={(e) => e.stopPropagation()}
    >
      <a
        href={`tel:${raw}`}
        className="inline-flex items-center gap-1 text-primary hover:underline font-mono text-inherit cursor-pointer"
        title={`Call ${raw}`}
        aria-label={`Call ${raw}`}
        onClick={(e) => e.stopPropagation()}
      >
        {showIcon && <Phone className={iconClassName} />}
        <span>{raw}</span>
      </a>
      {showWhatsApp && cleanDigits.length >= 10 && (
        <a
          href={`https://wa.me/${waDigits}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center h-5 w-5 rounded-full hover:bg-green-100 dark:hover:bg-green-950/40 text-green-600 transition-colors cursor-pointer"
          title={`WhatsApp message ${raw}`}
          aria-label={`WhatsApp message ${raw}`}
          onClick={(e) => e.stopPropagation()}
        >
          <MessageSquare className="h-3 w-3" />
        </a>
      )}
    </span>
  );
}

import { PrismaClient, PlanType, NotificationType, NotificationChannel } from '@prisma/client';

const prisma = new PrismaClient();

async function seedGymPlans() {
  const plans = [
    {
      name: 'Trial',
      type: PlanType.TRIAL,
      description: '14-day trial with core features, capped limits.',
      monthlyPrice: 0,
      yearlyPrice: 0,
      maxMembers: 25,
      maxTrainers: 2,
      maxBatches: 3,
      features: ['members', 'attendance', 'basic_reports'],
    },
    {
      name: 'Monthly',
      type: PlanType.BASIC,
      description: 'Full feature set, billed monthly.',
      monthlyPrice: 1999,
      yearlyPrice: 21600,
      maxMembers: 300,
      maxTrainers: 15,
      maxBatches: 25,
      features: ['members', 'attendance', 'payments', 'reports', 'notifications', 'public_profile'],
    },
    {
      name: 'Quarterly',
      type: PlanType.STANDARD,
      description: 'Full feature set, billed every 3 months at a discount.',
      monthlyPrice: 1799,
      yearlyPrice: 19800,
      maxMembers: 500,
      maxTrainers: 25,
      maxBatches: 40,
      features: ['members', 'attendance', 'payments', 'reports', 'notifications', 'public_profile'],
    },
    {
      name: 'Half-Yearly',
      type: PlanType.PREMIUM,
      description: 'Full feature set, billed every 6 months at a discount.',
      monthlyPrice: 1599,
      yearlyPrice: 18000,
      maxMembers: 800,
      maxTrainers: 40,
      maxBatches: 60,
      features: ['members', 'attendance', 'payments', 'reports', 'notifications', 'public_profile', 'api_access'],
    },
    {
      name: 'Yearly',
      type: PlanType.ENTERPRISE,
      description: 'Full feature set, best value, billed annually.',
      monthlyPrice: 1299,
      yearlyPrice: 15600,
      maxMembers: 2000,
      maxTrainers: 100,
      maxBatches: 150,
      features: ['members', 'attendance', 'payments', 'reports', 'notifications', 'public_profile', 'api_access', 'priority_support'],
    },
  ];

  for (const plan of plans) {
    await prisma.gymPlan.upsert({
      where: { name: plan.name },
      create: plan,
      update: plan,
    });
  }
  console.log(`Seeded ${plans.length} gym plans`);
}

async function seedNotificationTemplates() {
  const templates = [
    {
      name: 'membership_expiry',
      type: NotificationType.MEMBERSHIP_EXPIRY,
      channel: NotificationChannel.EMAIL,
      subject: 'Your MuscleOS membership expires in {{daysLeft}} days',
      body: 'Hi {{memberName}}, your {{planName}} membership expires in {{daysLeft}} days. Renew now to keep your access uninterrupted.',
      variables: ['memberName', 'planName', 'daysLeft'],
    },
    {
      name: 'birthday_wish',
      type: NotificationType.BIRTHDAY,
      channel: NotificationChannel.EMAIL,
      subject: 'Happy Birthday, {{memberName}}! 🎉',
      body: 'Happy Birthday {{memberName}}! Wishing you a strong year ahead. See you at the gym!',
      variables: ['memberName'],
    },
    {
      name: 'payment_success',
      type: NotificationType.PAYMENT_SUCCESS,
      channel: NotificationChannel.EMAIL,
      subject: 'Payment received — Receipt {{receiptNumber}}',
      body: 'Hi {{memberName}}, we received your payment of {{amount}}. Receipt: {{receiptNumber}}.',
      variables: ['memberName', 'amount', 'receiptNumber'],
    },
    {
      name: 'payment_failed',
      type: NotificationType.PAYMENT_FAILED,
      channel: NotificationChannel.EMAIL,
      subject: 'Payment failed',
      body: 'Hi {{memberName}}, your payment of {{amount}} could not be processed. Please try again or contact the front desk.',
      variables: ['memberName', 'amount'],
    },
    {
      name: 'batch_change',
      type: NotificationType.BATCH_CHANGE,
      channel: NotificationChannel.EMAIL,
      subject: 'Your batch timing has changed',
      body: 'Hi {{memberName}}, your batch "{{batchName}}" is now scheduled at {{newTiming}}. Please update your routine accordingly.',
      variables: ['memberName', 'batchName', 'newTiming'],
    },
  ];

  for (const template of templates) {
    await prisma.notificationTemplate.upsert({
      where: { name: template.name },
      create: template,
      update: template,
    });
  }
  console.log(`Seeded ${templates.length} notification templates`);
}

async function main() {
  await seedGymPlans();
  await seedNotificationTemplates();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

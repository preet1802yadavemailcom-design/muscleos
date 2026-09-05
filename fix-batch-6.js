const fs = require("fs");
const path = require("path");

function patch(file, replacements) {
  if (!fs.existsSync(file)) {
    console.error(`[MISSING] ${file}`);
    return;
  }
  let content = fs.readFileSync(file, "utf8");
  let changed = false;
  for (const { find, replace, label } of replacements) {
    if (content.includes(replace)) {
      console.log(`[SKIP] ${label} — already patched`);
      continue;
    }
    if (!content.includes(find)) {
      console.error(`[FAIL] ${label} — anchor not found in ${file}`);
      continue;
    }
    content = content.replace(find, replace);
    changed = true;
    console.log(`[OK] ${label}`);
  }
  if (changed) {
    fs.writeFileSync(file, content, "utf8");
    console.log(`[SAVED] ${file}`);
  }
}

patch(path.join("backend", "src", "modules", "payments", "payments.service.ts"), [
  {
    label: "confirmUpiClaim — atomic status transition (was findFirst-then-update race)",
    find: `    if (!payment) throw new NotFoundException('UPI payment claim not found');
    if (payment.status !== PaymentStatus.PENDING) {
      throw new BadRequestException(\`This claim is already \${payment.status.toLowerCase()}.\`);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id },
        data: { status: PaymentStatus.COMPLETED, verifiedAt: new Date(), verifiedById: staffUserId, collectedById: staffUserId },
      });
      for (const alloc of payment.monthAllocations) {
        await tx.membershipMonth.update({ where: { id: alloc.membershipMonthId }, data: { status: 'PAID', paymentId: id } });
      }
      if (payment.membershipId) {
        await this.unlockNextMonth(tx, payment.membershipId);
      }
    });`,
    replace: `    if (!payment) throw new NotFoundException('UPI payment claim not found');
    if (payment.status !== PaymentStatus.PENDING) {
      throw new BadRequestException(\`This claim is already \${payment.status.toLowerCase()}.\`);
    }

    await this.prisma.$transaction(async (tx) => {
      // Atomic guard: only succeeds if status is STILL PENDING at write time.
      // Prevents two staff members clicking confirm at the same moment from
      // both completing (and both notifying/receipting) the same claim.
      const { count } = await tx.payment.updateMany({
        where: { id, status: PaymentStatus.PENDING },
        data: { status: PaymentStatus.COMPLETED, verifiedAt: new Date(), verifiedById: staffUserId, collectedById: staffUserId },
      });
      if (count === 0) {
        throw new ConflictException('This claim was already processed by someone else.');
      }
      for (const alloc of payment.monthAllocations) {
        await tx.membershipMonth.update({ where: { id: alloc.membershipMonthId }, data: { status: 'PAID', paymentId: id } });
      }
      if (payment.membershipId) {
        await this.unlockNextMonth(tx, payment.membershipId);
      }
    });`,
  },
  {
    label: "rejectUpiClaim — atomic status transition (was findFirst-then-update race)",
    find: `    if (!payment) throw new NotFoundException('UPI payment claim not found');
    if (payment.status !== PaymentStatus.PENDING) {
      throw new BadRequestException(\`This claim is already \${payment.status.toLowerCase()}.\`);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.payment.update({
        where: { id },
        data: { status: PaymentStatus.FAILED, notes: reason ? \`Rejected: \${reason}\` : 'Rejected by staff' },
      });
      for (const alloc of payment.monthAllocations) {
        await tx.membershipMonth.update({ where: { id: alloc.membershipMonthId }, data: { status: 'PAYABLE', paymentId: null } });
      }
      return u;
    });`,
    replace: `    if (!payment) throw new NotFoundException('UPI payment claim not found');
    if (payment.status !== PaymentStatus.PENDING) {
      throw new BadRequestException(\`This claim is already \${payment.status.toLowerCase()}.\`);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.payment.updateMany({
        where: { id, status: PaymentStatus.PENDING },
        data: { status: PaymentStatus.FAILED, notes: reason ? \`Rejected: \${reason}\` : 'Rejected by staff' },
      });
      if (count === 0) {
        throw new ConflictException('This claim was already processed by someone else.');
      }
      for (const alloc of payment.monthAllocations) {
        await tx.membershipMonth.update({ where: { id: alloc.membershipMonthId }, data: { status: 'PAYABLE', paymentId: null } });
      }
      return tx.payment.findUniqueOrThrow({ where: { id } });
    });`,
  },
  {
    label: "verifyManualPayment — atomic status transition (was findFirst-then-update race)",
    find: `    if (!payment) throw new NotFoundException('Payment not found in this gym.');
    if (payment.status !== 'PENDING') {
      throw new BadRequestException('Only PENDING payments can be verified.');
    }

    const newStatus: PaymentStatus = approve ? 'COMPLETED' : 'FAILED';

    await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: paymentId },
        data: { status: newStatus, verifiedById: verifierUserId, verifiedAt: new Date() },
      });
      for (const alloc of payment.monthAllocations) {`,
    replace: `    if (!payment) throw new NotFoundException('Payment not found in this gym.');
    if (payment.status !== 'PENDING') {
      throw new BadRequestException('Only PENDING payments can be verified.');
    }

    const newStatus: PaymentStatus = approve ? 'COMPLETED' : 'FAILED';

    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.payment.updateMany({
        where: { id: paymentId, status: 'PENDING' },
        data: { status: newStatus, verifiedById: verifierUserId, verifiedAt: new Date() },
      });
      if (count === 0) {
        throw new ConflictException('This payment was already verified by someone else.');
      }
      for (const alloc of payment.monthAllocations) {`,
  },
  {
    label: "refund() — track refundedAmount so a second partial refund is possible",
    find: `  async refund(id: string, gymId: string, dto: RefundPaymentDto, userId: string) {
    const payment = await this.findOne(id, gymId);
    if (payment.status !== PaymentStatus.COMPLETED) {
      // Also blocks a second refund attempt outright â€” once PARTIALLY_REFUNDED
      // or REFUNDED, status is no longer COMPLETED, so a duplicate/retried
      // refund request can't silently double-refund on the gateway side.
      throw new BadRequestException('Only completed payments can be refunded');
    }
    const refundAmount = dto.amount ?? Number(payment.total);
    if (refundAmount > Number(payment.total)) {
      throw new BadRequestException('Refund amount cannot exceed the paid amount');
    }

    if (payment.gateway === PaymentGateway.RAZORPAY && payment.gatewayPaymentId) {
      await this.razorpay.refund(payment.gatewayPaymentId, Math.round(refundAmount * 100));
    } else if (payment.gateway === PaymentGateway.STRIPE && payment.gatewayPaymentId) {
      await this.stripe.refund(payment.gatewayPaymentId, Math.round(refundAmount * 100));
    }
    // Cash/UPI/bank-transfer refunds are recorded but must be settled manually.

    const isFullRefund = refundAmount >= Number(payment.total);
    const updated = await this.prisma.payment.update({
      where: { id },
      data: { status: isFullRefund ? PaymentStatus.REFUNDED : PaymentStatus.PARTIALLY_REFUNDED, notes: \`\${payment.notes ?? ''}\\nRefund: \${dto.reason}\`.trim() },
    });

    await this.audit.log({ action: 'REFUND', entity: 'Payment', entityId: id, oldValue: payment, newValue: updated, gymId, userId });
    return updated;
  }`,
    replace: `  async refund(id: string, gymId: string, dto: RefundPaymentDto, userId: string) {
    const payment = await this.findOne(id, gymId);
    if (payment.status !== PaymentStatus.COMPLETED && payment.status !== PaymentStatus.PARTIALLY_REFUNDED) {
      // REFUNDED (fully) is still blocked; COMPLETED and PARTIALLY_REFUNDED
      // (which can still have more refunded, up to the remaining balance)
      // are both allowed so a second partial refund is no longer impossible.
      throw new BadRequestException('Only completed or partially-refunded payments can be refunded');
    }
    const alreadyRefunded = Number((payment as any).refundedAmount ?? 0);
    const remaining = Number(payment.total) - alreadyRefunded;
    const refundAmount = dto.amount ?? remaining;
    if (refundAmount <= 0 || refundAmount > remaining) {
      throw new BadRequestException(\`Refund amount cannot exceed the remaining refundable balance (â‚¹\${remaining.toFixed(2)})\`);
    }

    if (payment.gateway === PaymentGateway.RAZORPAY && payment.gatewayPaymentId) {
      await this.razorpay.refund(payment.gatewayPaymentId, Math.round(refundAmount * 100));
    } else if (payment.gateway === PaymentGateway.STRIPE && payment.gatewayPaymentId) {
      await this.stripe.refund(payment.gatewayPaymentId, Math.round(refundAmount * 100));
    }
    // Cash/UPI/bank-transfer refunds are recorded but must be settled manually.

    const newRefundedTotal = alreadyRefunded + refundAmount;
    const isFullRefund = newRefundedTotal >= Number(payment.total);

    // Atomic guard: status must still match what we checked above, so two
    // concurrent refund clicks can't both deduct from the same remaining balance.
    const { count } = await this.prisma.payment.updateMany({
      where: { id, status: payment.status },
      data: {
        status: isFullRefund ? PaymentStatus.REFUNDED : PaymentStatus.PARTIALLY_REFUNDED,
        refundedAmount: newRefundedTotal,
        notes: \`\${payment.notes ?? ''}\\nRefund: \${dto.reason} (â‚¹\${refundAmount.toFixed(2)})\`.trim(),
      } as any,
    });
    if (count === 0) {
      throw new ConflictException('This payment was just modified by another request â€” please refresh and try again.');
    }
    const updated = await this.prisma.payment.findUniqueOrThrow({ where: { id } });

    await this.audit.log({ action: 'REFUND', entity: 'Payment', entityId: id, oldValue: payment, newValue: updated, gymId, userId });
    return updated;
  }`,
  },
]);

console.log("\nDone.");

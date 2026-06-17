export const LEAVE_TYPE_APPROVED_OT_COMP = 'approved ot comp';
export const LEAVE_TYPE_TRAINING = 'training';

export function normalizeLeaveType(type: string): string {
  return type.trim().toLowerCase();
}

export function isApprovedOtCompLeave(type: string): boolean {
  return normalizeLeaveType(type) === LEAVE_TYPE_APPROVED_OT_COMP;
}

export function isTrainingLeave(type: string): boolean {
  return normalizeLeaveType(type) === LEAVE_TYPE_TRAINING;
}

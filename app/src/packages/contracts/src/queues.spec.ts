import { QueueName } from './queues';

describe('QueueName', () => {
  it('userCascadeDelete === "user.cascade.delete"', () => {
    expect(QueueName.userCascadeDelete).toBe('user.cascade.delete');
  });

  it('retentionPrune === "retention.prune"', () => {
    expect(QueueName.retentionPrune).toBe('retention.prune');
  });

  it('attachmentsCleanup === "attachments.cleanup"', () => {
    expect(QueueName.attachmentsCleanup).toBe('attachments.cleanup');
  });

  it('abuseReportNotify === "abuse.report.notify"', () => {
    expect(QueueName.abuseReportNotify).toBe('abuse.report.notify');
  });

  it('every queue name matches "domain.action" pattern (1-3 dots, lowercase)', () => {
    // 2 to 4 segments => 1 to 3 dots
    const pattern = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*){1,3}$/;
    const values = Object.values(QueueName);
    expect(values.length).toBeGreaterThan(0);
    for (const v of values) {
      expect(v).toMatch(pattern);
      expect(v).toBe(v.toLowerCase());
    }
  });

  it('has unique values', () => {
    const values = Object.values(QueueName);
    expect(new Set(values).size).toBe(values.length);
  });
});

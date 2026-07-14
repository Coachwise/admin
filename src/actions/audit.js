/**
 * Appends to admin_audit_log. Takes the transaction client, not the global one,
 * so the audit row commits or rolls back with the change it describes — an
 * approval that rolled back must not leave a record saying it happened.
 */
export async function audit(tx, { adminId, action, resource, resourceId, detail }) {
  await tx.admin_audit_log.create({
    data: {
      admin_user_id: adminId,
      action,
      resource,
      resource_id: resourceId ? String(resourceId) : null,
      detail: detail ?? undefined,
    },
  });
}

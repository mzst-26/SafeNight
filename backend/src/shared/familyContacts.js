/**
 * familyContacts.js — Automatically link family pack members as emergency contacts.
 *
 * When a family pack is activated or a new member joins, we ensure every
 * pair of members with a user_id is connected as "accepted" contacts.
 */

const { supabase } = require('../user/lib/supabase');

/**
 * Ensure all active members of a family pack are mutual emergency contacts.
 * Skips members without a user_id (haven't signed up yet).
 * Creates bi-directional "accepted" contacts — no invite needed.
 *
 * @param {string} packId — The family_packs.id to sync
 */
async function syncFamilyPackContacts(packId) {
  try {
    // Get all members who have signed up (have a user_id)
    const { data: members, error } = await supabase
      .from('family_pack_members')
      .select('user_id')
      .eq('pack_id', packId)
      .not('user_id', 'is', null)
      .in('status', ['active', 'owner']);

    if (error || !members || members.length < 2) return;

    const userIds = [...new Set(members.map((m) => m.user_id))];
    if (userIds.length < 2) return;

    // Build all pairs
    const pairs = [];
    for (let i = 0; i < userIds.length; i++) {
      for (let j = i + 1; j < userIds.length; j++) {
        pairs.push([userIds[i], userIds[j]]);
      }
    }

    for (const [a, b] of pairs) {
      // Check if relationship already exists (either direction)
      const { data: existing } = await supabase
        .from('emergency_contacts')
        .select('id, status')
        .or(
          `and(user_id.eq.${a},contact_id.eq.${b}),and(user_id.eq.${b},contact_id.eq.${a})`,
        )
        .maybeSingle();

      if (existing) {
        // If already accepted, nothing to do
        if (existing.status === 'accepted') continue;
        // If pending/rejected, upgrade to accepted
        if (existing.status !== 'blocked') {
          await supabase
            .from('emergency_contacts')
            .update({ status: 'accepted', updated_at: new Date().toISOString() })
            .eq('id', existing.id);
          console.log(`[familyContacts] Upgraded contact ${a} ↔ ${b} to accepted`);
        }
        continue;
      }

      // Create new accepted contact (no invite flow needed)
      const { error: insertErr } = await supabase
        .from('emergency_contacts')
        .insert({
          user_id: a,
          contact_id: b,
          nickname: '',
          status: 'accepted',
        });

      if (insertErr) {
        console.warn(`[familyContacts] Insert ${a} ↔ ${b} failed: ${insertErr.message}`);
      } else {
        console.log(`[familyContacts] Created contact ${a} ↔ ${b} (family pack ${packId})`);
      }
    }
  } catch (err) {
    // Non-fatal — don't break pack activation
    console.error(`[familyContacts] syncFamilyPackContacts error: ${err.message}`);
  }
}

/**
 * Remove emergency contacts between a removed user and all other pack members.
 * Deletes both directions of the contact link.
 *
 * @param {string} removedUserId — The user_id of the member being removed
 * @param {string} packId — The family_packs.id they were removed from
 */
async function removeFamilyPackContacts(removedUserId, packId) {
  try {
    if (!removedUserId) return;

    // Get all other members who have a user_id
    const { data: members, error } = await supabase
      .from('family_pack_members')
      .select('user_id')
      .eq('pack_id', packId)
      .not('user_id', 'is', null)
      .in('status', ['active', 'owner']);

    if (error || !members || members.length === 0) return;

    const otherIds = members
      .map((m) => m.user_id)
      .filter((id) => id && id !== removedUserId);

    if (otherIds.length === 0) return;

    // Delete contacts in both directions between the removed user and each remaining member
    for (const otherId of otherIds) {
      const { error: delErr } = await supabase
        .from('emergency_contacts')
        .delete()
        .or(
          `and(user_id.eq.${removedUserId},contact_id.eq.${otherId}),and(user_id.eq.${otherId},contact_id.eq.${removedUserId})`,
        );

      if (delErr) {
        console.warn(`[familyContacts] Failed to remove contact ${removedUserId} ↔ ${otherId}: ${delErr.message}`);
      } else {
        console.log(`[familyContacts] Removed contact ${removedUserId} ↔ ${otherId}`);
      }
    }
  } catch (err) {
    console.error(`[familyContacts] removeFamilyPackContacts error: ${err.message}`);
  }
}

module.exports = { syncFamilyPackContacts, removeFamilyPackContacts };

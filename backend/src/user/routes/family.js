/**
 * family.js — Family/Friends Pack subscription routes.
 *
 * Allows a main account holder to purchase Guarded (pro) subscriptions
 * at £3/user/month for 3+ members. Sub-users' subscriptions are linked
 * to the owner's account.
 *
 * POST /api/family/create          — Create a family pack (min 3 members)
 * GET  /api/family/my-pack         — Get current user's pack (as owner or member)
 * POST /api/family/add-member      — Add a member to the pack
 * POST /api/family/remove-member   — Remove a member from the pack
 * POST /api/family/checkout        — Create Stripe checkout for family pack
 * POST /api/family/cancel          — Cancel the family pack
 */

const express = require('express');
const { supabase } = require('../lib/supabase');
const { requireAuth } = require('../middleware/authMiddleware');
const { syncFamilyPackContacts, removeFamilyPackContacts } = require('../../shared/familyContacts');

const router = express.Router();

const PRICE_PER_USER = 3.00; // £3/user/month
const MIN_MEMBERS = 3;
const MAX_MEMBERS = 20; // reasonable upper limit
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Update the Stripe subscription quantity to match the current member count.
 * Also updates max_members on the pack record.
 */
async function updateStripeQuantity(packId, newQuantity) {
  // Get the stripe_subscription_id and current max_members from the pack
  const { data: pack } = await supabase
    .from('family_packs')
    .select('stripe_subscription_id, max_members')
    .eq('id', packId)
    .single();

  if (!pack?.stripe_subscription_id) {
    console.warn(`[family] No stripe_subscription_id on pack ${packId} — skipping quantity update`);
    return;
  }

  const { getStripe } = require('../../subscription/lib/stripeClient');
  const stripe = getStripe();

  // Retrieve the subscription to get the item ID and current quantity
  const sub = await stripe.subscriptions.retrieve(pack.stripe_subscription_id);
  const item = sub.items?.data?.[0];
  if (!item) {
    throw new Error(`No subscription items found for ${pack.stripe_subscription_id}`);
  }

  const oldQuantity = item.quantity;

  // Step 1: Update Stripe first (billing source of truth)
  await stripe.subscriptions.update(pack.stripe_subscription_id, {
    items: [{ id: item.id, quantity: newQuantity }],
    proration_behavior: 'always_invoice',
    payment_behavior: 'allow_incomplete',
  });

  // Step 2: Mirror the quantity in the database
  const { error: dbError } = await supabase
    .from('family_packs')
    .update({ max_members: newQuantity })
    .eq('id', packId);

  if (dbError) {
    // DB failed after Stripe succeeded — roll back Stripe to keep them in sync
    console.error(`[family] ⚠️ DB update failed after Stripe update — rolling back Stripe quantity: ${dbError.message}`);
    try {
      await stripe.subscriptions.update(pack.stripe_subscription_id, {
        items: [{ id: item.id, quantity: oldQuantity }],
        proration_behavior: 'none', // no charge/credit for the rollback
      });
      console.log(`[family] Stripe quantity rolled back to ${oldQuantity}`);
    } catch (rollbackErr) {
      console.error(
        `[family] ⚠️ CRITICAL: Stripe rollback also failed! ` +
        `Stripe has quantity=${newQuantity} but DB has max_members=${pack.max_members}. ` +
        `Manual fix required.`,
        rollbackErr.message,
      );
    }
    throw new Error('Failed to update database after Stripe billing change');
  }

  console.log(`[family] Updated Stripe quantity for pack ${packId} → ${newQuantity}`);
}

// ─── POST /api/family/create ─────────────────────────────────────────────────
// Create a new family pack. The owner is automatically added as a member.
// Body: { name?, members: [{ email, name? }, ...] }
// At least 3 members required (including the owner).
router.post('/create', requireAuth, async (req, res, next) => {
  try {
    const { name, members } = req.body;

    if (!Array.isArray(members) || members.length < MIN_MEMBERS - 1) {
      return res.status(400).json({
        error: `You need at least ${MIN_MEMBERS - 1} other members to create a Family Pack (${MIN_MEMBERS} total including you).`,
      });
    }

    if (members.length > MAX_MEMBERS - 1) {
      return res.status(400).json({
        error: `Maximum ${MAX_MEMBERS} total members per pack.`,
      });
    }

    // Validate member emails
    for (const m of members) {
      if (!m.email || !EMAIL_RE.test(m.email.trim().toLowerCase())) {
        return res.status(400).json({ error: `Invalid email: ${m.email}` });
      }
    }

    // Get owner's profile
    const { data: ownerProfile } = await supabase
      .from('profiles')
      .select('id, email, name')
      .eq('id', req.user.id)
      .single();

    if (!ownerProfile) {
      return res.status(404).json({ error: 'Owner profile not found' });
    }

    // Check if owner already has an active pack
    const { data: existingPack } = await supabase
      .from('family_packs')
      .select('id')
      .eq('owner_id', req.user.id)
      .eq('status', 'active')
      .maybeSingle();

    if (existingPack) {
      return res.status(409).json({
        error: 'You already have an active Family Pack. Cancel it first to create a new one.',
      });
    }

    // Check if owner is already a member of another pack
    const { data: existingMembership } = await supabase
      .from('family_pack_members')
      .select('id, pack_id')
      .eq('email', ownerProfile.email)
      .eq('status', 'active')
      .maybeSingle();

    if (existingMembership) {
      return res.status(409).json({
        error: 'You are already a member of another Family Pack.',
      });
    }

    const totalMembers = members.length + 1; // +1 for owner
    const totalPrice = totalMembers * PRICE_PER_USER;

    // Create the pack
    const { data: pack, error: packError } = await supabase
      .from('family_packs')
      .insert({
        owner_id: req.user.id,
        name: name || `${ownerProfile.name || 'My'}'s Pack`,
        max_members: totalMembers,
        price_per_user: PRICE_PER_USER,
        status: 'pending', // becomes 'active' after payment
      })
      .select()
      .single();

    if (packError) {
      console.error('[family] Pack create error:', packError.message);
      return res.status(500).json({ error: 'Failed to create pack' });
    }

    // Add owner as first member
    await supabase.from('family_pack_members').insert({
      pack_id: pack.id,
      user_id: req.user.id,
      email: ownerProfile.email,
      name: ownerProfile.name,
      role: 'owner',
      status: 'active',
      joined_at: new Date().toISOString(),
    });

    // Add other members (pending until they activate/sign up)
    const memberRows = members.map((m) => ({
      pack_id: pack.id,
      email: m.email.trim().toLowerCase(),
      name: m.name || null,
      role: 'member',
      status: 'pending',
    }));

    const { error: membersError } = await supabase
      .from('family_pack_members')
      .insert(memberRows);

    if (membersError) {
      console.error('[family] Members insert error:', membersError.message);
      // Clean up the pack
      await supabase.from('family_packs').delete().eq('id', pack.id);
      return res.status(500).json({ error: 'Failed to add members' });
    }

    // Send Supabase invite emails to all members and track results
    const emailResults = [];
    for (const m of members) {
      const email = m.email.trim().toLowerCase();
      try {
        const { data, error: inviteError } = await supabase.auth.admin.inviteUserByEmail(email, {
          data: { invited_by: ownerProfile.name, family_pack_id: pack.id },
          redirectTo: `${process.env.FRONTEND_URL || 'safenight://'}`,
        });
        // "User already registered" is fine — they already have an account
        const sent = !inviteError || inviteError.message?.includes('already registered');
        emailResults.push({ email, sent });
        await supabase
          .from('family_pack_members')
          .update({ invite_sent: sent })
          .eq('pack_id', pack.id)
          .eq('email', email);
      } catch (err) {
        console.error(`[family] Invite to ${email} failed:`, err.message);
        emailResults.push({ email, sent: false });
        await supabase
          .from('family_pack_members')
          .update({ invite_sent: false })
          .eq('pack_id', pack.id)
          .eq('email', email);
      }
    }

    res.json({
      pack: {
        id: pack.id,
        name: pack.name,
        totalMembers,
        pricePerUser: PRICE_PER_USER,
        totalMonthly: totalPrice,
        status: pack.status,
      },
      emailResults,
      message: `Family Pack created with ${totalMembers} members. Total: £${totalPrice.toFixed(2)}/month.`,
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/family/my-pack ─────────────────────────────────────────────────
// Returns the user's family pack (as owner) or the pack they belong to (as member).
router.get('/my-pack', requireAuth, async (req, res, next) => {
  try {
    // Check if user owns a pack
    let pack = null;
    let role = null;

    const { data: ownedPack } = await supabase
      .from('family_packs')
      .select('*')
      .eq('owner_id', req.user.id)
      .in('status', ['active', 'pending', 'cancelling'])
      .maybeSingle();

    if (ownedPack) {
      pack = ownedPack;
      role = 'owner';
    } else {
      // Check if user is a member of someone else's pack
      const { data: ownerProfile } = await supabase
        .from('profiles')
        .select('email')
        .eq('id', req.user.id)
        .single();

      if (ownerProfile?.email) {
        const { data: membership } = await supabase
          .from('family_pack_members')
          .select('pack_id, role, status')
          .eq('email', ownerProfile.email)
          .in('status', ['active', 'pending'])
          .maybeSingle();

        if (membership) {
          const { data: memberPack } = await supabase
            .from('family_packs')
            .select('*')
            .eq('id', membership.pack_id)
            .in('status', ['active', 'pending', 'cancelling'])
            .single();

          if (memberPack) {
            pack = memberPack;
            role = membership.role;
          }
        }
      }
    }

    if (!pack) {
      return res.json({ pack: null });
    }

    // Fetch all members (include invite_sent for email status tracking)
    const { data: members } = await supabase
      .from('family_pack_members')
      .select('id, email, name, role, status, joined_at, user_id, invite_sent')
      .eq('pack_id', pack.id)
      .neq('status', 'removed')
      .order('role', { ascending: true }) // owner first
      .order('joined_at', { ascending: true });

    // Get owner profile
    const { data: ownerInfo } = await supabase
      .from('profiles')
      .select('name, email')
      .eq('id', pack.owner_id)
      .single();

    const activeCount = (members || []).filter(m => m.status === 'active').length;
    const pendingCount = (members || []).filter(m => m.status === 'pending').length;
    const activeMemberCount = (members || []).length; // non-removed members
    const vacantSlots = pack.max_members - activeMemberCount;

    res.json({
      pack: {
        id: pack.id,
        name: pack.name,
        status: pack.status,
        maxMembers: pack.max_members,
        pricePerUser: parseFloat(pack.price_per_user),
        totalMonthly: parseFloat(pack.price_per_user) * pack.max_members,
        createdAt: pack.created_at,
        expiresAt: pack.expires_at,
        stripeSubscriptionId: pack.stripe_subscription_id,
        cancelAt: pack.cancel_at || null,
        owner: {
          name: ownerInfo?.name || 'Unknown',
          email: ownerInfo?.email || '',
        },
      },
      members: members || [],
      role,
      stats: {
        active: activeCount,
        pending: pendingCount,
        total: activeMemberCount,
        vacantSlots: vacantSlots > 0 ? vacantSlots : 0,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/family/add-member ─────────────────────────────────────────────
// Add a new member to an existing pack. Only the pack owner can do this.
// Body: { email, name? }
router.post('/add-member', requireAuth, async (req, res, next) => {
  try {
    const { email, name } = req.body;

    if (!email || !EMAIL_RE.test(email.trim().toLowerCase())) {
      return res.status(400).json({ error: 'Valid email is required' });
    }

    const cleanEmail = email.trim().toLowerCase();

    // Find owner's pack
    const { data: pack } = await supabase
      .from('family_packs')
      .select('id, max_members, status')
      .eq('owner_id', req.user.id)
      .eq('status', 'active')
      .single();

    if (!pack) {
      return res.status(404).json({ error: 'You do not have an active Family Pack' });
    }

    // Check current member count
    const { count: memberCount } = await supabase
      .from('family_pack_members')
      .select('id', { count: 'exact', head: true })
      .eq('pack_id', pack.id)
      .neq('status', 'removed');

    if (memberCount >= MAX_MEMBERS) {
      return res.status(400).json({ error: `Maximum ${MAX_MEMBERS} members per pack` });
    }

    // Check if email already in pack
    const { data: existing } = await supabase
      .from('family_pack_members')
      .select('id, status')
      .eq('pack_id', pack.id)
      .eq('email', cleanEmail)
      .maybeSingle();

    if (existing && existing.status !== 'removed') {
      return res.status(409).json({ error: 'This email is already in your pack' });
    }

    // Re-activate if previously removed, otherwise insert
    let memberId;
    if (existing && existing.status === 'removed') {
      await supabase
        .from('family_pack_members')
        .update({
          status: 'pending',
          name: name || existing.name,
          removed_at: null,
          invited_at: new Date().toISOString(),
        })
        .eq('id', existing.id);
      memberId = existing.id;
    } else {
      const { data: inserted } = await supabase.from('family_pack_members').insert({
        pack_id: pack.id,
        email: cleanEmail,
        name: name || null,
        role: 'member',
        status: 'pending',
      }).select('id').single();
      memberId = inserted?.id;
    }

    // Update max_members (pack grows — pricing adjusts)
    const newTotal = (memberCount || 0) + 1;
    const oldMaxMembers = pack.max_members;
    if (newTotal > pack.max_members) {
      await supabase
        .from('family_packs')
        .update({ max_members: newTotal })
        .eq('id', pack.id);
    }

    // Update Stripe subscription quantity — if this fails, roll back the
    // member insert/reactivation so billing and DB stay in sync.
    try {
      await updateStripeQuantity(pack.id, newTotal);
    } catch (stripeErr) {
      console.error(`[family] Stripe quantity update failed — rolling back member add: ${stripeErr.message}`);

      // Undo the member insert or reactivation
      if (existing && existing.status === 'removed') {
        await supabase.from('family_pack_members')
          .update({ status: 'removed', removed_at: new Date().toISOString() })
          .eq('id', existing.id);
      } else {
        await supabase.from('family_pack_members')
          .delete()
          .eq('pack_id', pack.id)
          .eq('email', cleanEmail);
      }

      // Undo max_members bump
      if (newTotal > oldMaxMembers) {
        await supabase.from('family_packs')
          .update({ max_members: oldMaxMembers })
          .eq('id', pack.id);
      }

      return res.status(502).json({
        error: 'Failed to update billing. The member was not added. Please try again.',
      });
    }

    // Check if user already has an account — if so, activate immediately
    const { data: existingUser } = await supabase
      .from('profiles')
      .select('id, name')
      .eq('email', cleanEmail)
      .maybeSingle();

    if (existingUser) {
      // Auto-activate: link user_id, set status to active
      await supabase
        .from('family_pack_members')
        .update({
          user_id: existingUser.id,
          status: 'active',
          joined_at: new Date().toISOString(),
          invite_sent: true,
        })
        .eq('pack_id', pack.id)
        .eq('email', cleanEmail);

      // Cancel any existing active subscription
      await supabase
        .from('subscriptions')
        .update({ status: 'replaced', cancelled_at: new Date().toISOString() })
        .eq('user_id', existingUser.id)
        .eq('status', 'active');

      // Create family-linked pro subscription
      await supabase.from('subscriptions').insert({
        user_id: existingUser.id,
        tier: 'pro',
        status: 'active',
        started_at: new Date().toISOString(),
        is_gift: false,
        is_family_pack: true,
        family_pack_id: pack.id,
      });

      // Update denormalized tier
      await supabase
        .from('profiles')
        .update({ subscription: 'pro' })
        .eq('id', existingUser.id);

      // Sync contacts so all pack members are connected
      await syncFamilyPackContacts(pack.id);

      console.log(`[family] Auto-activated existing user ${cleanEmail} in pack ${pack.id}`);

      return res.json({
        message: `${cleanEmail} added and activated in your Family Pack`,
        activated: true,
        emailSent: false,
        newTotal,
        newMonthly: newTotal * PRICE_PER_USER,
      });
    }

    // User doesn't exist yet — send invitation email
    const { data: ownerProfile } = await supabase
      .from('profiles')
      .select('name')
      .eq('id', req.user.id)
      .single();

    let emailSent = false;
    try {
      const { error: inviteError } = await supabase.auth.admin.inviteUserByEmail(cleanEmail, {
        data: { invited_by: ownerProfile?.name, family_pack_id: pack.id },
        redirectTo: `${process.env.FRONTEND_URL || 'safenight://'}`,
      });
      emailSent = !inviteError || inviteError.message?.includes('already registered');
    } catch (err) {
      console.error('[family] Invite error:', err.message);
    }

    // Update invite_sent status on the member record
    await supabase
      .from('family_pack_members')
      .update({ invite_sent: emailSent })
      .eq('pack_id', pack.id)
      .eq('email', cleanEmail);

    res.json({
      message: `${cleanEmail} added to your Family Pack`,
      activated: false,
      emailSent,
      newTotal,
      newMonthly: newTotal * PRICE_PER_USER,
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/family/remove-member ──────────────────────────────────────────
// Remove a member from the pack. Only the owner can remove members.
// Body: { email } or { member_id }
router.post('/remove-member', requireAuth, async (req, res, next) => {
  try {
    const { email, member_id } = req.body;

    // Find owner's pack
    const { data: pack } = await supabase
      .from('family_packs')
      .select('id')
      .eq('owner_id', req.user.id)
      .eq('status', 'active')
      .single();

    if (!pack) {
      return res.status(404).json({ error: 'You do not have an active Family Pack' });
    }

    // Find the member
    let query = supabase
      .from('family_pack_members')
      .select('id, email, role, user_id')
      .eq('pack_id', pack.id)
      .neq('status', 'removed');

    if (member_id) {
      query = query.eq('id', member_id);
    } else if (email) {
      query = query.eq('email', email.trim().toLowerCase());
    } else {
      return res.status(400).json({ error: 'Email or member_id is required' });
    }

    const { data: member } = await query.single();

    if (!member) {
      return res.status(404).json({ error: 'Member not found in your pack' });
    }

    if (member.role === 'owner') {
      return res.status(400).json({ error: 'Cannot remove the pack owner. Cancel the pack instead.' });
    }

    // Check that removing this member won't drop below the minimum
    const { count: currentCount } = await supabase
      .from('family_pack_members')
      .select('id', { count: 'exact', head: true })
      .eq('pack_id', pack.id)
      .neq('status', 'removed');

    if ((currentCount || 0) <= MIN_MEMBERS) {
      return res.status(400).json({
        error: `A Family Pack requires at least ${MIN_MEMBERS} members. To go below ${MIN_MEMBERS}, cancel the pack instead.`,
      });
    }

    // Count remaining active members (after this removal)
    const { count: currentTotal } = await supabase
      .from('family_pack_members')
      .select('id', { count: 'exact', head: true })
      .eq('pack_id', pack.id)
      .neq('status', 'removed');

    const remainingCount = (currentTotal || 1) - 1;

    // Update Stripe billing FIRST — if this fails the member stays and
    // the owner isn't over-charged for a removed member.
    try {
      await updateStripeQuantity(pack.id, remainingCount || 1);
    } catch (stripeErr) {
      console.error(`[family] Stripe quantity update failed — member NOT removed: ${stripeErr.message}`);
      return res.status(502).json({
        error: 'Failed to update billing. The member was not removed. Please try again.',
      });
    }

    // Stripe succeeded — now perform DB cleanup (safe to proceed)
    // Soft-remove the member
    await supabase
      .from('family_pack_members')
      .update({
        status: 'removed',
        removed_at: new Date().toISOString(),
      })
      .eq('id', member.id);

    // Remove emergency contacts between this member and other pack members
    if (member.user_id) {
      await removeFamilyPackContacts(member.user_id, pack.id);
    }

    // If the member had a user_id, revert their subscription to free
    if (member.user_id) {
      // Cancel their family-linked subscription
      await supabase
        .from('subscriptions')
        .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
        .eq('user_id', member.user_id)
        .eq('status', 'active')
        .eq('is_family_pack', true);

      // Create free subscription
      await supabase.from('subscriptions').insert({
        user_id: member.user_id,
        tier: 'free',
        status: 'active',
      });

      // Update denormalized tier
      await supabase
        .from('profiles')
        .update({ subscription: 'free' })
        .eq('id', member.user_id);
    }

    res.json({
      message: `${member.email} removed from your Family Pack`,
      remainingMembers: remainingCount,
      newMonthly: (remainingCount || 0) * PRICE_PER_USER,
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/family/activate ───────────────────────────────────────────────
// Called after Stripe payment succeeds to activate the pack and all members.
// Also called automatically when a pending member logs in.
router.post('/activate', requireAuth, async (req, res, next) => {
  try {
    // Find user's email
    const { data: profile } = await supabase
      .from('profiles')
      .select('email')
      .eq('id', req.user.id)
      .single();

    if (!profile?.email) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    // Check if user is a pending member of any active pack
    const { data: membership } = await supabase
      .from('family_pack_members')
      .select('id, pack_id, status')
      .eq('email', profile.email)
      .eq('status', 'pending')
      .maybeSingle();

    if (!membership) {
      return res.json({ activated: false, message: 'No pending Family Pack membership' });
    }

    // Check that the pack is active
    const { data: pack } = await supabase
      .from('family_packs')
      .select('id, status')
      .eq('id', membership.pack_id)
      .eq('status', 'active')
      .maybeSingle();

    if (!pack) {
      return res.json({ activated: false, message: 'Pack is not yet active' });
    }

    // Activate the membership
    await supabase
      .from('family_pack_members')
      .update({
        user_id: req.user.id,
        status: 'active',
        joined_at: new Date().toISOString(),
      })
      .eq('id', membership.id);

    // Give them a pro subscription linked to the family pack
    // First cancel any existing active subs
    await supabase
      .from('subscriptions')
      .update({ status: 'replaced', cancelled_at: new Date().toISOString() })
      .eq('user_id', req.user.id)
      .eq('status', 'active');

    // Create family-linked pro subscription
    await supabase.from('subscriptions').insert({
      user_id: req.user.id,
      tier: 'pro',
      status: 'active',
      started_at: new Date().toISOString(),
      is_gift: false,
      is_family_pack: true,
      family_pack_id: pack.id,
    });

    // Update denormalized tier
    await supabase
      .from('profiles')
      .update({ subscription: 'pro' })
      .eq('id', req.user.id);

    res.json({
      activated: true,
      message: 'Your Family Pack membership is now active! You have Guarded features.',
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/family/update-member-email ────────────────────────────────────
// Update a pending member's email address and resend the invitation.
// Only the pack owner can do this, and only for pending members.
// Body: { member_id, new_email }
router.post('/update-member-email', requireAuth, async (req, res, next) => {
  try {
    const { member_id, new_email } = req.body;

    if (!member_id || !new_email) {
      return res.status(400).json({ error: 'member_id and new_email are required' });
    }

    const cleanEmail = new_email.trim().toLowerCase();
    if (!EMAIL_RE.test(cleanEmail)) {
      return res.status(400).json({ error: 'Invalid email address' });
    }

    // Find owner's pack (active or pending)
    const { data: pack } = await supabase
      .from('family_packs')
      .select('id')
      .eq('owner_id', req.user.id)
      .in('status', ['active', 'pending'])
      .maybeSingle();

    if (!pack) {
      return res.status(404).json({ error: 'You do not have an active Family Pack' });
    }

    // Find the member and verify they're pending
    const { data: member } = await supabase
      .from('family_pack_members')
      .select('id, email, role, status')
      .eq('id', member_id)
      .eq('pack_id', pack.id)
      .single();

    if (!member) {
      return res.status(404).json({ error: 'Member not found in your pack' });
    }

    if (member.role === 'owner') {
      return res.status(400).json({ error: 'Cannot change the owner email' });
    }

    if (member.status !== 'pending') {
      return res.status(400).json({ error: 'Can only change email for pending members' });
    }

    // Check if new email already exists in the pack
    const { data: existing } = await supabase
      .from('family_pack_members')
      .select('id')
      .eq('pack_id', pack.id)
      .eq('email', cleanEmail)
      .neq('status', 'removed')
      .maybeSingle();

    if (existing) {
      return res.status(409).json({ error: 'This email is already in your pack' });
    }

    // Update the email
    await supabase
      .from('family_pack_members')
      .update({
        email: cleanEmail,
        invited_at: new Date().toISOString(),
      })
      .eq('id', member_id);

    // Resend invitation email via Supabase and track result
    const { data: ownerProfile } = await supabase
      .from('profiles')
      .select('name')
      .eq('id', req.user.id)
      .single();

    let emailSent = false;
    try {
      const { error: inviteError } = await supabase.auth.admin.inviteUserByEmail(cleanEmail, {
        data: { invited_by: ownerProfile?.name, family_pack_id: pack.id },
        redirectTo: `${process.env.FRONTEND_URL || 'safenight://'}`,
      });
      emailSent = !inviteError || inviteError.message?.includes('already registered');
    } catch (err) {
      console.error('[family] Invite error:', err.message);
    }

    await supabase
      .from('family_pack_members')
      .update({ invite_sent: emailSent })
      .eq('pack_id', pack.id)
      .eq('email', cleanEmail);

    res.json({
      message: `Email updated to ${cleanEmail} and invitation resent`,
      emailSent,
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/family/resend-invite ──────────────────────────────────────────
// Resend invitation email to a pending member. Only the pack owner can do this.
// Body: { member_id }
router.post('/resend-invite', requireAuth, async (req, res, next) => {
  try {
    const { member_id } = req.body;

    if (!member_id) {
      return res.status(400).json({ error: 'member_id is required' });
    }

    // Find owner's pack (active or pending)
    const { data: pack } = await supabase
      .from('family_packs')
      .select('id')
      .eq('owner_id', req.user.id)
      .in('status', ['active', 'pending'])
      .maybeSingle();

    if (!pack) {
      return res.status(404).json({ error: 'You do not have an active Family Pack' });
    }

    // Find the member
    const { data: member } = await supabase
      .from('family_pack_members')
      .select('id, email, name, role, status')
      .eq('id', member_id)
      .eq('pack_id', pack.id)
      .single();

    if (!member) {
      return res.status(404).json({ error: 'Member not found in your pack' });
    }

    if (member.role === 'owner') {
      return res.status(400).json({ error: 'Cannot resend invite to the owner' });
    }

    if (member.status !== 'pending') {
      return res.status(400).json({ error: 'Can only resend invites to pending members' });
    }

    // Get owner name for the email
    const { data: ownerProfile } = await supabase
      .from('profiles')
      .select('name')
      .eq('id', req.user.id)
      .single();

    let emailSent = false;
    try {
      const { error: inviteError } = await supabase.auth.admin.inviteUserByEmail(member.email, {
        data: { invited_by: ownerProfile?.name, family_pack_id: pack.id },
        redirectTo: `${process.env.FRONTEND_URL || 'safenight://'}`,
      });
      emailSent = !inviteError || inviteError.message?.includes('already registered');
    } catch (err) {
      console.error('[family] Resend invite error:', err.message);
    }

    await supabase
      .from('family_pack_members')
      .update({ invite_sent: emailSent, invited_at: new Date().toISOString() })
      .eq('id', member_id);

    if (!emailSent) {
      return res.status(502).json({
        error: 'Failed to send invitation email. Please try again.',
        emailSent: false,
      });
    }

    res.json({
      message: `Invitation resent to ${member.email}`,
      emailSent: true,
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/family/checkout ───────────────────────────────────────────────
// Create a Stripe Checkout session for a family pack.
// Uses quantity-based pricing (£3 × member count).
router.post('/checkout', requireAuth, async (req, res, next) => {
  try {
    const { pack_id } = req.body;

    // Find the pack and verify ownership
    const { data: pack } = await supabase
      .from('family_packs')
      .select('id, owner_id, max_members, status')
      .eq('id', pack_id)
      .single();

    if (!pack) {
      return res.status(404).json({ error: 'Pack not found' });
    }

    if (pack.owner_id !== req.user.id) {
      return res.status(403).json({ error: 'Only the pack owner can purchase' });
    }

    if (pack.status === 'active') {
      return res.status(400).json({ error: 'Pack is already active. Use manage to update billing.' });
    }

    // Get or create Stripe customer
    const { data: profile } = await supabase
      .from('profiles')
      .select('email, name, stripe_customer_id')
      .eq('id', req.user.id)
      .single();

    let customerId = profile?.stripe_customer_id;

    if (!customerId) {
      // Defer to the subscription service for Stripe operations
      // For now, pass enough info to create checkout
    }

    const totalMembers = pack.max_members;
    const returnUrl = req.body.return_url || process.env.FRONTEND_URL || 'http://localhost:8083';

    // Return checkout info — the actual Stripe session is created by the subscription service
    const subscriptionServiceUrl = process.env.SUBSCRIPTION_SERVICE_URL || 'http://localhost:3004';

    res.json({
      checkoutUrl: `${subscriptionServiceUrl}/api/stripe/create-family-checkout`,
      packId: pack.id,
      totalMembers,
      pricePerUser: PRICE_PER_USER,
      totalMonthly: totalMembers * PRICE_PER_USER,
      message: `Family Pack checkout: ${totalMembers} members × £${PRICE_PER_USER}/mo = £${(totalMembers * PRICE_PER_USER).toFixed(2)}/month`,
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/family/cancel ─────────────────────────────────────────────────
// Cancel the entire family pack.
//
// Refund policy (14-day cooling-off):
//   • Within 14 days of the current billing period start → immediate full
//     refund for the current period, access revoked straight away.
//   • After 14 days → no refund, but the pack stays active until the end
//     of the current billing period and billing stops automatically.
//
const COOLING_OFF_DAYS = 14;

router.post('/cancel', requireAuth, async (req, res, next) => {
  try {
    // Find owner's active or cancelling pack
    const { data: pack } = await supabase
      .from('family_packs')
      .select('id, stripe_subscription_id, status')
      .eq('owner_id', req.user.id)
      .in('status', ['active', 'cancelling'])
      .single();

    if (!pack) {
      return res.status(404).json({ error: 'No active Family Pack found' });
    }

    if (pack.status === 'cancelling') {
      return res.status(400).json({
        error: 'Your Family Pack is already scheduled to cancel at the end of the current billing period.',
      });
    }

    // ── Determine if we are inside the 14-day cooling-off window ──────
    let withinCoolingOff = true; // default to immediate if no Stripe sub
    let periodEnd = null;

    if (pack.stripe_subscription_id) {
      const { getStripe } = require('../../subscription/lib/stripeClient');
      const stripe = getStripe();

      const sub = await stripe.subscriptions.retrieve(pack.stripe_subscription_id);
      const periodStart = sub.current_period_start * 1000; // ms
      const daysSincePeriodStart = (Date.now() - periodStart) / (1000 * 60 * 60 * 24);
      withinCoolingOff = daysSincePeriodStart <= COOLING_OFF_DAYS;
      periodEnd = new Date(sub.current_period_end * 1000).toISOString();

      console.log(
        `[family] Cancel request: ${daysSincePeriodStart.toFixed(1)} days into period ` +
        `(cooling-off=${withinCoolingOff})`
      );

      if (withinCoolingOff) {
        // ── IMMEDIATE CANCEL + FULL REFUND ────────────────────────────
        // Cancel Stripe sub immediately.
        await stripe.subscriptions.cancel(sub.id, { prorate: true });

        // Refund ALL paid invoices for this subscription that have a
        // payment_intent (skips proration credit notes which have none).
        try {
          const invoices = await stripe.invoices.list({
            subscription: sub.id,
            status: 'paid',
            limit: 20,
          });

          for (const invoice of invoices.data) {
            if (!invoice.payment_intent || invoice.amount_paid <= 0) continue;
            try {
              const piId = typeof invoice.payment_intent === 'string'
                ? invoice.payment_intent
                : invoice.payment_intent.id;
              await stripe.refunds.create({
                payment_intent: piId,
                reason: 'requested_by_customer',
              });
              console.log(`[family] Refunded invoice ${invoice.id} (£${(invoice.amount_paid / 100).toFixed(2)}) for pack ${pack.id}`);
            } catch (refundErr) {
              // already refunded or other issue — log but continue
              console.error(`[family] Refund for invoice ${invoice.id} failed: ${refundErr.message}`);
            }
          }
        } catch (listErr) {
          console.error(`[family] Failed to list invoices for refund: ${listErr.message}`);
        }
      } else {
        // ── END-OF-PERIOD CANCEL (no refund) ─────────────────────────
        // Keep access until billing period ends, then Stripe fires
        // customer.subscription.deleted and our webhook cleans up.
        await stripe.subscriptions.update(sub.id, {
          cancel_at_period_end: true,
        });

        // Mark the pack as "cancelling" so the UI can show a notice.
        // If this DB write fails, revert the Stripe change so they stay in sync.
        const { error: dbCancelErr } = await supabase
          .from('family_packs')
          .update({
            status: 'cancelling',
            cancel_at: periodEnd,
          })
          .eq('id', pack.id);

        if (dbCancelErr) {
          console.error(`[family] ⚠️ DB update failed after Stripe cancel_at_period_end — rolling back Stripe: ${dbCancelErr.message}`);
          try {
            await stripe.subscriptions.update(sub.id, {
              cancel_at_period_end: false,
            });
          } catch (rollbackErr) {
            console.error(`[family] ⚠️ CRITICAL: Stripe rollback also failed! Sub ${sub.id} will cancel at period end but pack ${pack.id} still shows active. Manual fix required.`, rollbackErr.message);
          }
          return res.status(500).json({ error: 'Something went wrong. Please try again.' });
        }

        console.log(`[family] Pack ${pack.id} set to cancel at period end (${periodEnd})`);

        return res.json({
          message: 'Your Family Pack will remain active until the end of your billing period. No further charges will be made.',
          cancelAt: periodEnd,
          refunded: false,
        });
      }
    }

    // ── Immediate revocation (cooling-off refund or no Stripe sub) ────
    await revokeFamilyPack(pack.id);

    res.json({
      message: 'Family Pack cancelled and refunded. All members have been reverted to the free plan.',
      refunded: true,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Revoke a family pack immediately — revert all members to free, mark pack
 * as cancelled, and mark all members as removed.
 * Shared between the cancel route (cooling-off refund) and the webhook
 * (end-of-period expiry).
 */
async function revokeFamilyPack(packId) {
  // Get all active members
  const { data: members } = await supabase
    .from('family_pack_members')
    .select('user_id, email')
    .eq('pack_id', packId)
    .in('status', ['active', 'pending']);

  // Revert each member to free tier
  for (const member of (members || [])) {
    if (!member.user_id) continue;

    await supabase
      .from('subscriptions')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
      .eq('user_id', member.user_id)
      .eq('status', 'active')
      .eq('is_family_pack', true);

    await supabase.from('subscriptions').insert({
      user_id: member.user_id,
      tier: 'free',
      status: 'active',
    });

    await supabase
      .from('profiles')
      .update({ subscription: 'free' })
      .eq('id', member.user_id);
  }

  // Cancel the pack
  await supabase
    .from('family_packs')
    .update({
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
    })
    .eq('id', packId);

  // Mark all members as removed
  await supabase
    .from('family_pack_members')
    .update({ status: 'removed', removed_at: new Date().toISOString() })
    .eq('pack_id', packId);

  // Remove all emergency contacts that were auto-created between pack members
  const userIds = (members || []).map(m => m.user_id).filter(Boolean);
  if (userIds.length >= 2) {
    for (let i = 0; i < userIds.length; i++) {
      for (let j = i + 1; j < userIds.length; j++) {
        await supabase
          .from('emergency_contacts')
          .delete()
          .or(
            `and(user_id.eq.${userIds[i]},contact_id.eq.${userIds[j]}),and(user_id.eq.${userIds[j]},contact_id.eq.${userIds[i]})`,
          );
      }
    }
    console.log(`[family] Removed emergency contacts between ${userIds.length} pack members`);
  }

  console.log(`[family] Pack ${packId} fully revoked — all members reverted to free`);
}

module.exports = router;
module.exports.revokeFamilyPack = revokeFamilyPack;

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
const { sendEmail } = require('../../shared/email');

const router = express.Router();

const PRICE_PER_USER = 3.00; // £3/user/month
const MIN_MEMBERS = 3;
const MAX_MEMBERS = 20; // reasonable upper limit
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

    res.json({
      pack: {
        id: pack.id,
        name: pack.name,
        totalMembers,
        pricePerUser: PRICE_PER_USER,
        totalMonthly: totalPrice,
        status: pack.status,
      },
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
      .in('status', ['active', 'pending'])
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
            .in('status', ['active', 'pending'])
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

    // Fetch all members
    const { data: members } = await supabase
      .from('family_pack_members')
      .select('id, email, name, role, status, joined_at, user_id')
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
        total: (members || []).length,
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
    } else {
      await supabase.from('family_pack_members').insert({
        pack_id: pack.id,
        email: cleanEmail,
        name: name || null,
        role: 'member',
        status: 'pending',
      });
    }

    // Update max_members (pack grows — pricing adjusts)
    const newTotal = (memberCount || 0) + 1;
    if (newTotal > pack.max_members) {
      await supabase
        .from('family_packs')
        .update({ max_members: newTotal })
        .eq('id', pack.id);
    }

    // Send invitation email (fire and forget)
    const { data: ownerProfile } = await supabase
      .from('profiles')
      .select('name')
      .eq('id', req.user.id)
      .single();

    sendEmail({
      to: cleanEmail,
      subject: `You've been added to ${ownerProfile?.name || 'a'} SafeNight Family Pack`,
      html: `
        <h2>Welcome to SafeNight! 🛡️</h2>
        <p><strong>${ownerProfile?.name || 'Someone'}</strong> has added you to their SafeNight Family Pack.</p>
        <p>You now have access to <strong>Guarded (Pro)</strong> features including:</p>
        <ul>
          <li>Unlimited route searches</li>
          <li>Up to 10km walking routes</li>
          <li>Unlimited navigation sessions</li>
          <li>5 emergency contacts</li>
          <li>AI-powered safety explanations</li>
        </ul>
        <p>Just log in with this email address to activate your benefits.</p>
        <p style="color: #6B7280; font-size: 12px;">SafeNight — Walk Safe, Stay Connected</p>
      `,
    }).catch((err) => console.error('[family] Email send error:', err.message));

    res.json({
      message: `${cleanEmail} added to your Family Pack`,
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

    // Soft-remove the member
    await supabase
      .from('family_pack_members')
      .update({
        status: 'removed',
        removed_at: new Date().toISOString(),
      })
      .eq('id', member.id);

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

    // Count remaining active members
    const { count: remainingCount } = await supabase
      .from('family_pack_members')
      .select('id', { count: 'exact', head: true })
      .eq('pack_id', pack.id)
      .neq('status', 'removed');

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
// Cancel the entire family pack. Reverts all members to free tier.
router.post('/cancel', requireAuth, async (req, res, next) => {
  try {
    // Find owner's active pack
    const { data: pack } = await supabase
      .from('family_packs')
      .select('id')
      .eq('owner_id', req.user.id)
      .eq('status', 'active')
      .single();

    if (!pack) {
      return res.status(404).json({ error: 'No active Family Pack found' });
    }

    // Get all active members
    const { data: members } = await supabase
      .from('family_pack_members')
      .select('user_id, email')
      .eq('pack_id', pack.id)
      .eq('status', 'active');

    // Revert all members to free tier
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
      .eq('id', pack.id);

    // Mark all members as removed
    await supabase
      .from('family_pack_members')
      .update({ status: 'removed', removed_at: new Date().toISOString() })
      .eq('pack_id', pack.id);

    res.json({
      message: 'Family Pack cancelled. All members reverted to free tier.',
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

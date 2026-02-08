// ============================================================================
// SENTRY v3 — Payments Module (Stripe)
// ============================================================================
//
// Handles Stripe integration for subscriptions with Apple Pay & Google Pay.
//
// Usage:
//   SentryPayments.init()                  — Load Stripe.js
//   SentryPayments.checkout('pro')         — Start checkout for a plan
//   SentryPayments.manageBilling()         — Open billing portal
//   SentryPayments.renderPricingUI(el)     — Render pricing cards
//   SentryPayments.renderPlanBadge(el)     — Render current plan badge
// ============================================================================

const SentryPayments = (() => {
  // --- Config ---
  const STRIPE_PK = 'pk_live_YOUR_KEY'; // Replace with your Stripe publishable key

  const PLANS = {
    free: {
      name: 'Free',
      price: '$0',
      period: '',
      features: [
        '3 scans / month',
        'Up to 10 accounts',
        'Today range only',
        'Basic analyst',
      ],
      cta: 'Current plan',
      recommended: false,
    },
    pro: {
      name: 'Pro',
      price: '$19',
      period: '/month',
      features: [
        '100 scans / month',
        'Unlimited accounts',
        'All time ranges',
        'Live feed',
        'All AI models',
        'Scan history',
      ],
      cta: 'Upgrade to Pro',
      recommended: true,
    },
    ultra: {
      name: 'Ultra',
      price: '$49',
      period: '/month',
      features: [
        'Unlimited scans',
        'Unlimited accounts',
        'All time ranges',
        'Live feed',
        'All AI models',
        'Scheduled scans',
        'API access',
        'Priority support',
      ],
      cta: 'Upgrade to Ultra',
      recommended: false,
    },
  };

  let stripe = null;
  let stripeLoaded = false;

  // --- Stripe.js Loader ---

  async function init() {
    if (stripeLoaded) return;
    try {
      // Load Stripe.js dynamically
      if (!window.Stripe) {
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'https://js.stripe.com/v3/';
          script.onload = resolve;
          script.onerror = reject;
          document.head.appendChild(script);
        });
      }
      stripe = window.Stripe(STRIPE_PK);
      stripeLoaded = true;
    } catch (e) {
      console.warn('Stripe.js failed to load:', e.message);
    }
  }

  // --- Checkout ---

  async function checkout(plan) {
    if (!SentryAuth.isAuthenticated()) {
      // Show auth modal
      openAuthModal('signup');
      return;
    }

    try {
      const data = await SentryAPI.createCheckout(plan);
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (e) {
      console.error('Checkout error:', e.message);
      alert('Failed to start checkout. Please try again.');
    }
  }

  // --- Billing Portal ---

  async function manageBilling() {
    if (!SentryAuth.isAuthenticated()) return;
    try {
      await SentryAPI.openBillingPortal();
    } catch (e) {
      console.error('Billing portal error:', e.message);
    }
  }

  // --- UI Renderers ---

  function renderPricingUI(container) {
    const currentPlan = SentryAPI.getPlanName();
    const isAuth = SentryAuth.isAuthenticated();

    let h = '<div class="pricing-grid">';
    for (const [key, plan] of Object.entries(PLANS)) {
      const isCurrent = currentPlan === key;
      const isUpgrade = !isCurrent && key !== 'free';
      h += `<div class="pricing-card${plan.recommended ? ' recommended' : ''}${isCurrent ? ' current' : ''}">`;
      if (plan.recommended) h += '<div class="pricing-badge">Most popular</div>';
      h += `<div class="pricing-name">${plan.name}</div>`;
      h += `<div class="pricing-price">${plan.price}<span class="pricing-period">${plan.period}</span></div>`;
      h += '<ul class="pricing-features">';
      plan.features.forEach(f => {
        h += `<li>✓ ${f}</li>`;
      });
      h += '</ul>';

      if (isCurrent) {
        h += `<button class="pricing-btn current" disabled>Current plan</button>`;
      } else if (isUpgrade) {
        h += `<button class="pricing-btn upgrade" onclick="SentryPayments.checkout('${key}')">${plan.cta}</button>`;
      } else if (key === 'free' && currentPlan !== 'free') {
        // Downgrade via billing portal
        h += `<button class="pricing-btn" onclick="SentryPayments.manageBilling()">Manage</button>`;
      } else if (!isAuth) {
        h += `<button class="pricing-btn" onclick="openAuthModal('signup')">Sign up free</button>`;
      }
      h += '</div>';
    }
    h += '</div>';

    // Apple Pay / Google Pay note
    h += '<div class="pricing-footer">';
    h += '<span class="pay-icons">💳 </span>';
    h += 'Pay with card, Apple Pay, or Google Pay';
    h += '</div>';

    container.innerHTML = h;
  }

  function renderPlanBadge(container) {
    const plan = SentryAPI.getPlanName();
    if (plan === 'free' || plan === 'byok') {
      container.innerHTML = '';
      return;
    }
    const colors = { pro: 'var(--blue)', ultra: 'var(--purple)' };
    const bgs = { pro: 'var(--blue-10)', ultra: 'var(--purple-10)' };
    container.innerHTML = `<span class="plan-badge" style="color:${colors[plan]};background:${bgs[plan]}">${plan}</span>`;
  }

  function renderScansRemaining(container) {
    if (!SentryAPI.isBackendMode()) {
      container.innerHTML = '';
      return;
    }
    const remaining = SentryAPI.getScansRemaining();
    if (remaining === -1) {
      container.innerHTML = '<span class="scans-info">unlimited scans</span>';
    } else {
      const color = remaining <= 1 ? 'var(--red)' : remaining <= 5 ? 'var(--amber)' : 'var(--text-muted)';
      container.innerHTML = `<span class="scans-info" style="color:${color}">${remaining} scans left</span>`;
    }
  }

  // --- Billing callback handling ---

  function handleBillingCallback() {
    const params = new URLSearchParams(window.location.search);
    const billing = params.get('billing');
    if (billing === 'success') {
      // Show success message
      setTimeout(() => {
        const notices = document.getElementById('notices');
        if (notices) {
          notices.innerHTML = '<div class="notice" style="color:var(--green);background:var(--green-10)">✓ Subscription activated! Welcome to Sentry Pro.</div>';
        }
      }, 500);
      // Refresh user profile to get updated plan
      SentryAPI.getUserProfile();
      // Clean URL
      history.replaceState(null, '', window.location.pathname);
    }
    if (billing === 'cancel') {
      history.replaceState(null, '', window.location.pathname);
    }
  }

  // --- Public API ---
  return {
    init,
    checkout,
    manageBilling,
    renderPricingUI,
    renderPlanBadge,
    renderScansRemaining,
    handleBillingCallback,
    PLANS,
  };
})();

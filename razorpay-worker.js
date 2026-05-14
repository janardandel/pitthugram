// Pitthugram — Razorpay Cloudflare Worker
// Deploy this in Cloudflare Dashboard → Workers & Pages → Create Worker
// Secrets to set: RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET

const ALLOWED_ORIGIN = 'https://pitthugram.com';

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const path = url.pathname;

        const cors = {
            'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        };

        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: cors });
        }

        if (path === '/api/razorpay/create-order' && request.method === 'POST') {
            return createOrder(request, env, cors);
        }

        if (path === '/api/razorpay/verify-payment' && request.method === 'POST') {
            return verifyPayment(request, env, cors);
        }

        return new Response('Not Found', { status: 404 });
    }
};

async function createOrder(request, env, cors) {
    let body;
    try {
        body = await request.json();
    } catch {
        return json({ error: 'Invalid request body' }, 400, cors);
    }

    const { amount, customerName, customerEmail } = body;
    if (!amount || !customerEmail) {
        return json({ error: 'amount and customerEmail are required' }, 400, cors);
    }

    const credentials = btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`);

    const res = await fetch('https://api.razorpay.com/v1/orders', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Basic ${credentials}`,
        },
        body: JSON.stringify({
            amount: amount * 100, // paise
            currency: 'INR',
            receipt: `rcpt_${Date.now()}`,
            notes: { customerName, customerEmail },
        }),
    });

    const order = await res.json();
    if (!res.ok) {
        return json({ error: order.error?.description || 'Order creation failed' }, 500, cors);
    }

    return json({ order_id: order.id, amount: order.amount, currency: order.currency }, 200, cors);
}

async function verifyPayment(request, env, cors) {
    let body;
    try {
        body = await request.json();
    } catch {
        return json({ error: 'Invalid request body' }, 400, cors);
    }

    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = body;
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
        return json({ error: 'Missing payment fields' }, 400, cors);
    }

    const message = `${razorpay_order_id}|${razorpay_payment_id}`;

    const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(env.RAZORPAY_KEY_SECRET),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );

    const sigBuffer = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
    const expectedSig = Array.from(new Uint8Array(sigBuffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

    if (expectedSig !== razorpay_signature) {
        return json({ success: false, error: 'Payment verification failed' }, 400, cors);
    }

    return json({ success: true }, 200, cors);
}

function json(data, status, cors) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { ...cors, 'Content-Type': 'application/json' },
    });
}

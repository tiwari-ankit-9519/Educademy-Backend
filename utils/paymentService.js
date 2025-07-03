import Razorpay from "razorpay";
import Stripe from "stripe";

class PaymentService {
  constructor() {
    this.razorpay = null;
    this.stripe = null;
    this.paypal = null;

    this.initializePaymentGateways();
  }

  initializePaymentGateways() {
    if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
      try {
        this.razorpay = new Razorpay({
          key_id: process.env.RAZORPAY_KEY_ID,
          key_secret: process.env.RAZORPAY_KEY_SECRET,
        });
        console.log("✅ Razorpay initialized successfully");
      } catch (error) {
        console.error("❌ Failed to initialize Razorpay:", error.message);
      }
    } else {
      console.warn("⚠️  Razorpay credentials not found");
    }

    if (process.env.STRIPE_SECRET_KEY) {
      try {
        this.stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
        console.log("✅ Stripe initialized successfully");
      } catch (error) {
        console.error("❌ Failed to initialize Stripe:", error.message);
      }
    } else {
      console.warn("⚠️  Stripe credentials not found");
    }

    if (process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET) {
      try {
        console.log("✅ PayPal credentials found (implementation pending)");
      } catch (error) {
        console.error("❌ Failed to initialize PayPal:", error.message);
      }
    } else {
      console.warn("⚠️  PayPal credentials not found");
    }
  }

  getRazorpay() {
    if (!this.razorpay) {
      throw new Error(
        "Razorpay is not configured. Please check your credentials."
      );
    }
    return this.razorpay;
  }

  getStripe() {
    if (!this.stripe) {
      throw new Error(
        "Stripe is not configured. Please check your credentials."
      );
    }
    return this.stripe;
  }

  getPayPal() {
    if (!this.paypal) {
      throw new Error(
        "PayPal is not configured. Please check your credentials."
      );
    }
    return this.paypal;
  }

  isRazorpayAvailable() {
    return !!this.razorpay;
  }

  isStripeAvailable() {
    return !!this.stripe;
  }

  isPayPalAvailable() {
    return !!this.paypal;
  }

  getAvailableGateways() {
    const gateways = [];
    if (this.isRazorpayAvailable()) gateways.push("RAZORPAY");
    if (this.isStripeAvailable()) gateways.push("STRIPE");
    if (this.isPayPalAvailable()) gateways.push("PAYPAL");
    return gateways;
  }

  validateGateway(gateway) {
    const availableGateways = this.getAvailableGateways();
    return availableGateways.includes(gateway);
  }

  prepareStripeMetadata(metadata) {
    if (!metadata || typeof metadata !== "object") {
      return {};
    }

    const stripeMetadata = {};

    for (const [key, value] of Object.entries(metadata)) {
      if (value === null || value === undefined) {
        continue;
      }

      if (typeof value === "object") {
        stripeMetadata[key] = JSON.stringify(value);
      } else {
        stripeMetadata[key] = String(value);
      }
    }

    Object.keys(stripeMetadata).forEach((key) => {
      if (stripeMetadata[key].length > 500) {
        stripeMetadata[key] = stripeMetadata[key].substring(0, 497) + "...";
      }
    });

    if (Object.keys(stripeMetadata).length > 50) {
      const limitedMetadata = {};
      Object.keys(stripeMetadata)
        .slice(0, 50)
        .forEach((key) => {
          limitedMetadata[key] = stripeMetadata[key];
        });
      return limitedMetadata;
    }

    return stripeMetadata;
  }

  async createOrder(gateway, orderData) {
    switch (gateway) {
      case "RAZORPAY":
        return await this.createRazorpayOrder(orderData);
      case "STRIPE":
        return await this.createStripePaymentIntent(orderData);
      case "PAYPAL":
        return await this.createPayPalOrder(orderData);
      default:
        throw new Error(`Unsupported gateway: ${gateway}`);
    }
  }

  async createRazorpayOrder(orderData) {
    const razorpay = this.getRazorpay();
    return await razorpay.orders.create({
      amount: Math.round(orderData.amount * 100),
      currency: orderData.currency || "INR",
      receipt: orderData.receipt,
      payment_capture: 1,
      notes: orderData.notes || {},
    });
  }

  async createStripePaymentIntent(orderData) {
    const stripe = this.getStripe();

    const stripeMetadata = this.prepareStripeMetadata(orderData.metadata);

    return await stripe.paymentIntents.create({
      amount: Math.round(orderData.amount * 100),
      currency: orderData.currency || "inr",
      metadata: stripeMetadata,
    });
  }

  async createStripeCheckoutSession(orderData) {
    const stripe = this.getStripe();

    const stripeMetadata = this.prepareStripeMetadata(orderData.metadata);

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: orderData.currency?.toLowerCase() || "inr",
            product_data: {
              name: orderData.description || "Course Purchase",
            },
            unit_amount: Math.round(orderData.amount * 100),
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${process.env.FRONTEND_URL}/payment/success?session_id={CHECKOUT_SESSION_ID}&order_id=${orderData.receipt}`,
      cancel_url: `${process.env.FRONTEND_URL}/payment/cancel?order_id=${orderData.receipt}`,
      metadata: stripeMetadata,
      client_reference_id: orderData.receipt,
    });

    return {
      id: session.id,
      url: session.url,
      client_secret: session.client_secret,
    };
  }

  async createPayPalOrder(orderData) {
    throw new Error("PayPal integration not implemented yet");
  }

  async verifyPayment(gateway, paymentData) {
    switch (gateway) {
      case "RAZORPAY":
        return this.verifyRazorpayPayment(paymentData);
      case "STRIPE":
        return await this.verifyStripePayment(paymentData);
      case "PAYPAL":
        return await this.verifyPayPalPayment(paymentData);
      default:
        throw new Error(`Unsupported gateway: ${gateway}`);
    }
  }

  async verifyRazorpayPayment({ orderId, paymentId, signature }) {
    const crypto = await import("crypto");
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(`${orderId}|${paymentId}`)
      .digest("hex");
    return expectedSignature === signature;
  }

  async verifyStripePayment({ paymentIntentId }) {
    const stripe = this.getStripe();
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    return paymentIntent.status === "succeeded";
  }

  async verifyPayPalPayment(paymentData) {
    throw new Error("PayPal verification not implemented yet");
  }

  async fetchPaymentDetails(gateway, transactionId) {
    switch (gateway) {
      case "RAZORPAY":
        return await this.getRazorpay().payments.fetch(transactionId);
      case "STRIPE":
        return await this.getStripe().paymentIntents.retrieve(transactionId);
      case "PAYPAL":
        throw new Error("PayPal fetch not implemented yet");
      default:
        throw new Error(`Unsupported gateway: ${gateway}`);
    }
  }

  async createRefund(gateway, transactionId, refundData) {
    switch (gateway) {
      case "RAZORPAY":
        return await this.getRazorpay().payments.refund(transactionId, {
          amount: Math.round(refundData.amount * 100),
          notes: refundData.notes || {},
        });
      case "STRIPE":
        return await this.getStripe().refunds.create({
          payment_intent: transactionId,
          amount: Math.round(refundData.amount * 100),
          metadata: this.prepareStripeMetadata(refundData.metadata || {}),
        });
      case "PAYPAL":
        throw new Error("PayPal refund not implemented yet");
      default:
        throw new Error(`Unsupported gateway: ${gateway}`);
    }
  }
}

export default new PaymentService();

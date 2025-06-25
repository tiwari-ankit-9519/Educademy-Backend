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
    return await stripe.paymentIntents.create({
      amount: Math.round(orderData.amount * 100),
      currency: orderData.currency || "inr",
      metadata: orderData.metadata || {},
    });
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
          metadata: refundData.metadata || {},
        });
      case "PAYPAL":
        throw new Error("PayPal refund not implemented yet");
      default:
        throw new Error(`Unsupported gateway: ${gateway}`);
    }
  }
}

export default new PaymentService();

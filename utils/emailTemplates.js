const emailTemplates = {
  security: ({
    userName,
    title,
    subtitle,
    message,
    alertType,
    actionButton,
    actionUrl,
    details = [],
    securityTips = [],
    footerNote,
  }) => `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width,initial-scale=1">
        <meta name="x-apple-disable-message-reformatting">
        <title>${title} - Educademy</title>
        <style>
            table, td, div, h1, h2, h3, p, a, span {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            }
            table { border-collapse: collapse !important; }
            body { margin: 0 !important; padding: 0 !important; width: 100% !important; background-color: #f7f9fc; }
            
            @media (prefers-color-scheme: dark) {
                .email-container { background-color: #1a1a1a !important; }
                .email-body { background-color: #2d2d2d !important; color: #ffffff !important; }
                .security-header { background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%) !important; }
                .info-card { background-color: #374151 !important; border: 1px solid #4b5563 !important; }
            }
            
            @media screen and (max-width: 600px) {
                .email-container { width: 100% !important; max-width: 100% !important; }
                .content-padding { padding-left: 20px !important; padding-right: 20px !important; }
                .cta-button { width: 90% !important; font-size: 16px !important; padding: 15px 20px !important; }
                .info-grid { display: block !important; }
                .info-item { display: block !important; width: 100% !important; margin-bottom: 15px !important; }
            }
        </style>
    </head>
    <body style="margin: 0; padding: 0; background-color: #f7f9fc;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" class="email-container">
            <tr>
                <td style="padding: 20px 0; text-align: center;">
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="margin: 0 auto; max-width: 600px; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.1);" class="email-body">
                        
                        <tr>
                            <td style="background: linear-gradient(135deg, ${
                              alertType === "critical"
                                ? "#dc2626 0%, #b91c1c 100%"
                                : alertType === "warning"
                                ? "#f59e0b 0%, #d97706 100%"
                                : "#0ea5e9 0%, #0284c7 100%"
                            }); padding: 40px 30px; text-align: center; border-radius: 12px 12px 0 0;" class="security-header">
                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                    <tr>
                                        <td style="text-align: center; padding-bottom: 20px;">
                                            <div style="display: inline-block; background-color: rgba(255,255,255,0.2); padding: 15px; border-radius: 50%;">
                                                <div style="width: 50px; height: 50px; background-color: #ffffff; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;">
                                                    <span style="font-size: 24px;">${
                                                      alertType === "critical"
                                                        ? "🚨"
                                                        : alertType ===
                                                          "warning"
                                                        ? "⚠️"
                                                        : "🔐"
                                                    }</span>
                                                </div>
                                            </div>
                                        </td>
                                    </tr>
                                </table>
                                <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 700; line-height: 1.2;">${title}</h1>
                                <p style="margin: 10px 0 0 0; color: rgba(255,255,255,0.9); font-size: 16px; line-height: 1.5;">${subtitle}</p>
                            </td>
                        </tr>
                        
                        <tr>
                            <td style="padding: 40px 30px;" class="content-padding">
                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                    <tr>
                                        <td style="padding-bottom: 30px; text-align: center;">
                                            <h2 style="margin: 0 0 15px 0; color: #1f2937; font-size: 22px; font-weight: 600;">Hi ${userName},</h2>
                                            <p style="margin: 0; color: #4b5563; font-size: 16px; line-height: 1.6;">${message}</p>
                                        </td>
                                    </tr>
                                </table>
                                
                                ${
                                  details.length > 0
                                    ? `
                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                    <tr>
                                        <td style="background-color: #f8fafc; border-radius: 12px; padding: 25px; margin-bottom: 30px;" class="info-card">
                                            <h3 style="margin: 0 0 20px 0; color: #1f2937; font-size: 18px; font-weight: 600; text-align: center;">📍 Details</h3>
                                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" class="info-grid">
                                                ${details
                                                  .map(
                                                    (detail, index) => `
                                                <tr>
                                                    <td style="width: 50%; padding: 12px 15px; vertical-align: top;" class="info-item">
                                                        <div style="color: #6b7280; font-size: 14px; font-weight: 500; margin-bottom: 5px;">${
                                                          detail.label
                                                        }</div>
                                                        <div style="color: #1f2937; font-size: 16px; font-weight: 600;">${
                                                          detail.value
                                                        }</div>
                                                    </td>
                                                    ${
                                                      index % 2 === 0 &&
                                                      details[index + 1]
                                                        ? `
                                                    <td style="width: 50%; padding: 12px 15px; vertical-align: top;" class="info-item">
                                                        <div style="color: #6b7280; font-size: 14px; font-weight: 500; margin-bottom: 5px;">${
                                                          details[index + 1]
                                                            .label
                                                        }</div>
                                                        <div style="color: #1f2937; font-size: 16px; font-weight: 600;">${
                                                          details[index + 1]
                                                            .value
                                                        }</div>
                                                    </td>
                                                    `
                                                        : index % 2 === 0
                                                        ? '<td style="width: 50%;"></td>'
                                                        : ""
                                                    }
                                                </tr>
                                                `
                                                  )
                                                  .join("")}
                                            </table>
                                        </td>
                                    </tr>
                                </table>
                                `
                                    : ""
                                }
                                
                                ${
                                  actionButton
                                    ? `
                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                    <tr>
                                        <td style="text-align: center; padding-bottom: 30px;">
                                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin: 0 auto;">
                                                <tr>
                                                    <td style="text-align: center;">
                                                        <a href="${
                                                          actionUrl || "#"
                                                        }" style="display: inline-block; background: linear-gradient(135deg, ${
                                        alertType === "critical"
                                          ? "#dc2626 0%, #b91c1c 100%"
                                          : alertType === "warning"
                                          ? "#f59e0b 0%, #d97706 100%"
                                          : "#0ea5e9 0%, #0284c7 100%"
                                      }); color: #ffffff; text-decoration: none; padding: 16px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;" class="cta-button">
                                                            ${actionButton}
                                                        </a>
                                                    </td>
                                                </tr>
                                            </table>
                                        </td>
                                    </tr>
                                </table>
                                `
                                    : ""
                                }
                                
                                ${
                                  securityTips.length > 0
                                    ? `
                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                    <tr>
                                        <td style="background-color: #f0f9ff; border-left: 4px solid #0ea5e9; padding: 20px; border-radius: 0 8px 8px 0;">
                                            <h4 style="margin: 0 0 12px 0; color: #0369a1; font-size: 16px; font-weight: 600;">💡 Security Tips</h4>
                                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                                ${securityTips
                                                  .map(
                                                    (tip) => `
                                                <tr>
                                                    <td style="padding: 4px 0;">
                                                        <span style="color: #0ea5e9; font-weight: 600; margin-right: 8px;">•</span>
                                                        <span style="color: #0c4a6e; font-size: 14px;">${tip}</span>
                                                    </td>
                                                </tr>
                                                `
                                                  )
                                                  .join("")}
                                            </table>
                                        </td>
                                    </tr>
                                </table>
                                `
                                    : ""
                                }
                                
                                ${
                                  footerNote
                                    ? `
                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                    <tr>
                                        <td style="background-color: #fef2f2; border-left: 4px solid #ef4444; padding: 20px; border-radius: 0 8px 8px 0; margin-top: 20px;">
                                            <p style="margin: 0; color: #7f1d1d; font-size: 14px; line-height: 1.5;">${footerNote}</p>
                                        </td>
                                    </tr>
                                </table>
                                `
                                    : ""
                                }
                            </td>
                        </tr>
                    </table>
                </td>
            </tr>
        </table>
    </body>
    </html>
  `,

  verification: ({
    userName,
    title,
    subtitle,
    message,
    code = null,
    codeLabel = "Verification Code",
    expirationMinutes = null,
    actionButton,
    actionUrl,
    features = [],
    tips = [],
    isSuccess = true,
  }) => `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width,initial-scale=1">
        <meta name="x-apple-disable-message-reformatting">
        <meta name="format-detection" content="telephone=no">
        <title>${title} - Educademy</title>
        <!--[if mso]>
        <noscript>
            <xml>
                <o:OfficeDocumentSettings>
                    <o:PixelsPerInch>96</o:PixelsPerInch>
                </o:OfficeDocumentSettings>
            </xml>
        </noscript>
        <![endif]-->
        <style>
            table, td, div, h1, h2, h3, p, a, span {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            }
            table { 
                border-collapse: collapse !important; 
                mso-table-lspace: 0pt !important;
                mso-table-rspace: 0pt !important;
            }
            body { 
                margin: 0 !important; 
                padding: 0 !important; 
                width: 100% !important; 
                min-width: 100% !important;
                background-color: #f7f9fc; 
                -webkit-text-size-adjust: 100%;
                -ms-text-size-adjust: 100%;
            }
            
            .email-container {
                width: 100% !important;
                max-width: 600px !important;
                margin: 0 auto !important;
            }
            
            .email-body {
                background-color: #ffffff;
                border-radius: 12px;
                box-shadow: 0 4px 20px rgba(0,0,0,0.1);
                width: 100%;
                max-width: 600px;
            }
            
            .verification-header {
                background: linear-gradient(135deg, ${
                  isSuccess
                    ? "#4f46e5 0%, #7c3aed 100%"
                    : "#059669 0%, #0d9488 100%"
                });
                padding: 40px 30px;
                text-align: center;
                border-radius: 12px 12px 0 0;
            }
            
            .primary-method {
                background: linear-gradient(135deg, #f3f4f6 0%, #e5e7eb 100%);
                border: 2px dashed #059669;
                border-radius: 12px;
                padding: 30px 20px;
                text-align: center;
                margin: 20px 0;
            }
            
            .backup-method {
                background-color: #f8fafc;
                border: 1px solid #e2e8f0;
                border-radius: 8px;
                padding: 20px;
                text-align: center;
                margin: 20px 0;
            }
            
            .code-display {
                font-family: 'Courier New', Courier, monospace;
                font-size: 36px;
                font-weight: 700;
                color: #059669;
                letter-spacing: 12px;
                margin: 15px 0;
                word-break: break-all;
                user-select: all;
            }
            
            .primary-button {
                display: inline-block;
                background: linear-gradient(135deg, ${
                  isSuccess
                    ? "#4f46e5 0%, #7c3aed 100%"
                    : "#059669 0%, #0d9488 100%"
                });
                color: #ffffff;
                text-decoration: none;
                padding: 16px 32px;
                border-radius: 8px;
                font-weight: 600;
                font-size: 16px;
                text-align: center;
                min-width: 200px;
            }
            
            .backup-button {
                display: inline-block;
                background-color: #f1f5f9;
                color: #475569;
                border: 2px solid #cbd5e1;
                text-decoration: none;
                padding: 12px 24px;
                border-radius: 6px;
                font-weight: 500;
                font-size: 14px;
                text-align: center;
                transition: all 0.3s ease;
            }
            
            .backup-button:hover {
                background-color: #e2e8f0;
                border-color: #94a3b8;
            }
            
            .feature-grid {
                width: 100%;
            }
            
            .feature-item {
                width: 33.33%;
                padding: 15px;
                text-align: center;
                vertical-align: top;
                display: inline-block;
            }
            
            .content-padding {
                padding: 40px 30px;
            }
            
            .expiration-notice {
                background-color: #fef3c7;
                border-radius: 8px;
                padding: 20px;
                margin: 20px 0;
                text-align: center;
            }
            
            .divider {
                border: none;
                height: 1px;
                background: linear-gradient(to right, transparent, #e2e8f0, transparent);
                margin: 25px 0;
            }
            
            .method-priority {
                background-color: #ecfdf5;
                border-left: 4px solid #10b981;
                padding: 15px 20px;
                margin: 20px 0;
                border-radius: 0 8px 8px 0;
            }
            
            @media (prefers-color-scheme: dark) {
                .email-body { 
                    background-color: #2d2d2d !important; 
                    color: #ffffff !important; 
                }
                .primary-method { 
                    background-color: #374151 !important; 
                    border: 2px dashed #4b5563 !important; 
                }
                .backup-method {
                    background-color: #1f2937 !important;
                    border-color: #374151 !important;
                }
                .method-priority {
                    background-color: #064e3b !important;
                    border-left-color: #10b981 !important;
                }
            }
            
            @media screen and (max-width: 600px) {
                .email-container { 
                    width: 100% !important; 
                    max-width: 100% !important; 
                    margin: 0 !important;
                }
                
                .email-body {
                    width: 100% !important;
                    max-width: 100% !important;
                    border-radius: 0 !important;
                    margin: 0 !important;
                }
                
                .content-padding { 
                    padding: 30px 20px !important; 
                }
                
                .verification-header {
                    padding: 30px 20px !important;
                    border-radius: 0 !important;
                }
                
                .code-display { 
                    font-size: 28px !important; 
                    letter-spacing: 6px !important;
                    line-height: 1.2 !important;
                }
                
                .primary-method { 
                    padding: 25px 15px !important;
                    margin: 15px 0 !important;
                }
                
                .backup-method {
                    padding: 15px !important;
                    margin: 15px 0 !important;
                }
                
                .primary-button { 
                    width: 90% !important; 
                    max-width: 280px !important;
                    font-size: 16px !important; 
                    padding: 15px 20px !important;
                    display: block !important;
                    margin: 0 auto !important;
                }
                
                .backup-button {
                    width: 85% !important;
                    max-width: 250px !important;
                    font-size: 14px !important;
                    padding: 12px 15px !important;
                    display: block !important;
                    margin: 10px auto !important;
                }
                
                .feature-grid {
                    display: block !important;
                    width: 100% !important;
                }
                
                .feature-item {
                    display: block !important;
                    width: 100% !important;
                    padding: 20px 0 !important;
                    margin-bottom: 15px !important;
                }
                
                .expiration-notice {
                    padding: 15px !important;
                    margin: 15px 0 !important;
                }
                
                .method-priority {
                    padding: 12px 15px !important;
                    margin: 15px 0 !important;
                }
                
                h1 {
                    font-size: 24px !important;
                    line-height: 1.3 !important;
                }
                
                h2 {
                    font-size: 20px !important;
                    line-height: 1.3 !important;
                }
                
                h3 {
                    font-size: 18px !important;
                    line-height: 1.3 !important;
                }
                
                p {
                    font-size: 15px !important;
                    line-height: 1.5 !important;
                }
            }
            
            @media screen and (max-width: 480px) {
                .content-padding { 
                    padding: 25px 15px !important; 
                }
                
                .verification-header {
                    padding: 25px 15px !important;
                }
                
                .code-display { 
                    font-size: 24px !important; 
                    letter-spacing: 4px !important;
                }
                
                .primary-method { 
                    padding: 20px 10px !important;
                }
                
                .backup-method {
                    padding: 12px !important;
                }
                
                .primary-button { 
                    font-size: 15px !important; 
                    padding: 14px 18px !important;
                }
                
                .backup-button {
                    font-size: 13px !important;
                    padding: 10px 12px !important;
                }
                
                .expiration-notice {
                    padding: 12px !important;
                }
                
                .method-priority {
                    padding: 10px 12px !important;
                }
                
                h1 {
                    font-size: 22px !important;
                }
                
                h2 {
                    font-size: 18px !important;
                }
                
                h3 {
                    font-size: 16px !important;
                }
                
                p {
                    font-size: 14px !important;
                }
            }
            
            @media all and (min-width: 560px) {
                .container {
                    border-radius: 8px !important;
                }
            }
            
            @media (-webkit-min-device-pixel-ratio: 1.25), (min-resolution: 120dpi) {
                .code-display {
                    -webkit-font-smoothing: antialiased;
                    -moz-osx-font-smoothing: grayscale;
                }
            }
        </style>
    </head>
    <body style="margin: 0; padding: 0; background-color: #f7f9fc; width: 100%; min-width: 100%;">
        <!--[if mso | IE]>
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
        <tr>
        <td align="center">
        <![endif]-->
        
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="width: 100%; min-width: 100%;">
            <tr>
                <td align="center" style="padding: 20px 10px;">
                    <div class="email-container" style="width: 100%; max-width: 600px; margin: 0 auto;">
                        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" class="email-body">
                            
                            <tr>
                                <td class="verification-header">
                                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                        <tr>
                                            <td style="text-align: center; padding-bottom: 20px;">
                                                <div style="display: inline-block; background-color: rgba(255,255,255,0.2); padding: 15px; border-radius: 50%; width: 80px; height: 80px; max-width: 80px;">
                                                    <div style="width: 50px; height: 50px; background-color: #ffffff; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; margin: 0 auto;">
                                                        <span style="font-size: 24px; line-height: 1;">${
                                                          isSuccess
                                                            ? "🎓"
                                                            : "🔐"
                                                        }</span>
                                                    </div>
                                                </div>
                                            </td>
                                        </tr>
                                    </table>
                                    <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 700; line-height: 1.2; text-align: center;">${title}</h1>
                                    <p style="margin: 10px 0 0 0; color: rgba(255,255,255,0.9); font-size: 16px; line-height: 1.5; text-align: center;">${subtitle}</p>
                                </td>
                            </tr>
                            
                            <tr>
                                <td class="content-padding">
                                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                        <tr>
                                            <td style="padding-bottom: 30px; text-align: center;">
                                                <h2 style="margin: 0 0 15px 0; color: #1f2937; font-size: 22px; font-weight: 600; text-align: center;">Hi ${userName},</h2>
                                                <p style="margin: 0; color: #4b5563; font-size: 16px; line-height: 1.6; text-align: center;">${message}</p>
                                            </td>
                                        </tr>
                                        
                                        ${
                                          code
                                            ? `
                                        <tr>
                                            <td>
                                                <div class="method-priority">
                                                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                                        <tr>
                                                            <td style="text-align: center;">
                                                                <span style="color: #10b981; font-size: 16px; margin-right: 8px; vertical-align: middle;">🚀</span>
                                                                <span style="color: #065f46; font-weight: 600; font-size: 14px; vertical-align: middle;">
                                                                    RECOMMENDED: Use the verification code below for quick access
                                                                </span>
                                                            </td>
                                                        </tr>
                                                    </table>
                                                </div>
                                            </td>
                                        </tr>
                                        
                                        <tr>
                                            <td style="padding-bottom: 20px;">
                                                <div class="primary-method">
                                                    <p style="margin: 0 0 15px 0; color: #374751; font-size: 14px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; text-align: center;">${codeLabel}</p>
                                                    <div class="code-display" style="text-align: center;">${code}</div>
                                                    <p style="margin: 15px 0 0 0; color: #6b7280; font-size: 13px; text-align: center;">Tap or click to select and copy this code</p>
                                                </div>
                                            </td>
                                        </tr>
                                        `
                                            : ""
                                        }
                                        
                                        ${
                                          expirationMinutes
                                            ? `
                                        <tr>
                                            <td>
                                                <div class="expiration-notice">
                                                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                                        <tr>
                                                            <td style="text-align: center;">
                                                                <span style="color: #92400e; font-size: 20px; margin-right: 10px; vertical-align: middle;">⏰</span>
                                                                <span style="color: #92400e; font-weight: 600; font-size: 16px; vertical-align: middle;">
                                                                    This code expires in 
                                                                    <span style="font-size: 18px; color: #d97706;">${expirationMinutes} minutes</span>
                                                                </span>
                                                            </td>
                                                        </tr>
                                                    </table>
                                                </div>
                                            </td>
                                        </tr>
                                        `
                                            : ""
                                        }
                                        
                                        ${
                                          actionButton && actionUrl && code
                                            ? `
                                        <tr>
                                            <td style="text-align: center; padding: 20px 0;">
                                                <hr class="divider">
                                                <p style="margin: 20px 0 15px 0; color: #6b7280; font-size: 14px; font-weight: 500; text-align: center;">Having trouble with the code?</p>
                                                <div class="backup-method">
                                                    <p style="margin: 0 0 15px 0; color: #475569; font-size: 14px; text-align: center;">Click the button below to verify instantly</p>
                                                    <a href="${actionUrl}" class="backup-button">
                                                        ${actionButton}
                                                    </a>
                                                    <p style="margin: 15px 0 0 0; color: #94a3b8; font-size: 12px; text-align: center;">This link will expire at the same time as your code</p>
                                                </div>
                                            </td>
                                        </tr>
                                        `
                                            : actionButton && actionUrl
                                            ? `
                                        <tr>
                                            <td style="text-align: center; padding: 30px 0;">
                                                <a href="${actionUrl}" class="primary-button">
                                                    ${actionButton}
                                                </a>
                                            </td>
                                        </tr>
                                        `
                                            : ""
                                        }
                                        
                                        ${
                                          features.length > 0
                                            ? `
                                        <tr>
                                            <td style="padding: 30px 0;">
                                                <hr class="divider">
                                                <h3 style="margin: 0 0 30px 0; color: #1f2937; font-size: 20px; font-weight: 600; text-align: center;">What Makes Educademy Special?</h3>
                                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" class="feature-grid">
                                                    <tr>
                                                        ${features
                                                          .slice(0, 3)
                                                          .map(
                                                            (feature) => `
                                                        <td class="feature-item">
                                                            <div style="background-color: ${
                                                              feature.bgColor ||
                                                              "#ddd6fe"
                                                            }; width: 50px; height: 50px; border-radius: 50%; margin: 0 auto 15px auto; display: table-cell; text-align: center; vertical-align: middle;">
                                                                <span style="font-size: 24px; line-height: 1;">${
                                                                  feature.icon
                                                                }</span>
                                                            </div>
                                                            <h4 style="margin: 0 0 8px 0; color: #1f2937; font-size: 16px; font-weight: 600; text-align: center;">${
                                                              feature.title
                                                            }</h4>
                                                            <p style="margin: 0; color: #6b7280; font-size: 14px; line-height: 1.4; text-align: center;">${
                                                              feature.description
                                                            }</p>
                                                        </td>
                                                        `
                                                          )
                                                          .join("")}
                                                    </tr>
                                                </table>
                                            </td>
                                        </tr>
                                        `
                                            : ""
                                        }
                                        
                                        ${
                                          tips.length > 0
                                            ? `
                                        <tr>
                                            <td style="padding: 30px 0 20px 0;">
                                                <h3 style="margin: 0 0 20px 0; color: #1f2937; font-size: 18px; font-weight: 600; text-align: center;">Quick Tips:</h3>
                                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                                    ${tips
                                                      .map(
                                                        (tip) => `
                                                    <tr>
                                                        <td style="padding: 8px 0; text-align: left;">
                                                            <span style="color: ${
                                                              isSuccess
                                                                ? "#4f46e5"
                                                                : "#059669"
                                                            }; font-weight: 600; margin-right: 8px; font-size: 16px;">✓</span>
                                                            <span style="color: #4b5563; font-size: 15px; line-height: 1.5;">${tip}</span>
                                                        </td>
                                                    </tr>
                                                    `
                                                      )
                                                      .join("")}
                                                </table>
                                            </td>
                                        </tr>
                                        `
                                            : ""
                                        }
                                    </table>
                                </td>
                            </tr>
                        </table>
                    </div>
                </td>
            </tr>
        </table>
        
        <!--[if mso | IE]>
        </td>
        </tr>
        </table>
        <![endif]-->
    </body>
    </html>`,
  transactional: ({
    userName,
    title,
    subtitle,
    message,
    transactionType,
    amount = null,
    currency = "INR",
    transactionId = null,
    details = [],
    actionButton,
    actionUrl,
    footerNote,
  }) => `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width,initial-scale=1">
        <meta name="x-apple-disable-message-reformatting">
        <title>${title} - Educademy</title>
        <style>
            table, td, div, h1, h2, h3, p, a, span {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            }
            table { border-collapse: collapse !important; }
            body { margin: 0 !important; padding: 0 !important; width: 100% !important; background-color: #f7f9fc; }
            
            @media (prefers-color-scheme: dark) {
                .email-container { background-color: #1a1a1a !important; }
                .email-body { background-color: #2d2d2d !important; color: #ffffff !important; }
                .transaction-header { background: linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%) !important; }
                .amount-card { background-color: #374151 !important; border: 1px solid #4b5563 !important; }
            }
            
            @media screen and (max-width: 600px) {
                .email-container { width: 100% !important; max-width: 100% !important; }
                .content-padding { padding-left: 20px !important; padding-right: 20px !important; }
                .cta-button { width: 90% !important; font-size: 16px !important; padding: 15px 20px !important; }
                .detail-grid { display: block !important; }
                .detail-item { display: block !important; width: 100% !important; margin-bottom: 15px !important; }
            }
        </style>
    </head>
    <body style="margin: 0; padding: 0; background-color: #f7f9fc;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" class="email-container">
            <tr>
                <td style="padding: 20px 0; text-align: center;">
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="margin: 0 auto; max-width: 600px; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.1);" class="email-body">
                        
                        <tr>
                            <td style="background: linear-gradient(135deg, ${
                              transactionType === "success"
                                ? "#059669 0%, #0d9488 100%"
                                : transactionType === "failed"
                                ? "#dc2626 0%, #b91c1c 100%"
                                : transactionType === "refund"
                                ? "#f59e0b 0%, #d97706 100%"
                                : "#0ea5e9 0%, #0284c7 100%"
                            }); padding: 40px 30px; text-align: center; border-radius: 12px 12px 0 0;" class="transaction-header">
                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                    <tr>
                                        <td style="text-align: center; padding-bottom: 20px;">
                                            <div style="display: inline-block; background-color: rgba(255,255,255,0.2); padding: 15px; border-radius: 50%;">
                                                <div style="width: 50px; height: 50px; background-color: #ffffff; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;">
                                                    <span style="font-size: 24px;">${
                                                      transactionType ===
                                                      "success"
                                                        ? "✅"
                                                        : transactionType ===
                                                          "failed"
                                                        ? "❌"
                                                        : transactionType ===
                                                          "refund"
                                                        ? "↩️"
                                                        : "💰"
                                                    }</span>
                                                </div>
                                            </div>
                                        </td>
                                    </tr>
                                </table>
                                <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 700; line-height: 1.2;">${title}</h1>
                                <p style="margin: 10px 0 0 0; color: rgba(255,255,255,0.9); font-size: 16px; line-height: 1.5;">${subtitle}</p>
                            </td>
                        </tr>
                        
                        <tr>
                            <td style="padding: 40px 30px;" class="content-padding">
                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                    <tr>
                                        <td style="padding-bottom: 30px; text-align: center;">
                                            <h2 style="margin: 0 0 15px 0; color: #1f2937; font-size: 22px; font-weight: 600;">Hi ${userName},</h2>
                                            <p style="margin: 0; color: #4b5563; font-size: 16px; line-height: 1.6;">${message}</p>
                                        </td>
                                    </tr>
                                </table>
                                
                                ${
                                  amount
                                    ? `
                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                    <tr>
                                        <td style="background: linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%); border-radius: 12px; padding: 30px; margin-bottom: 30px; text-align: center;" class="amount-card">
                                            <h3 style="margin: 0 0 10px 0; color: #64748b; font-size: 16px; font-weight: 500;">Amount</h3>
                                            <div style="font-size: 36px; font-weight: 700; color: ${
                                              transactionType === "success"
                                                ? "#059669"
                                                : transactionType === "failed"
                                                ? "#dc2626"
                                                : transactionType === "refund"
                                                ? "#f59e0b"
                                                : "#0ea5e9"
                                            };">
                                                ${
                                                  currency === "INR"
                                                    ? "₹"
                                                    : currency
                                                } ${amount}
                                            </div>
                                            ${
                                              transactionId
                                                ? `<p style="margin: 10px 0 0 0; color: #6b7280; font-size: 14px;">Transaction ID: ${transactionId}</p>`
                                                : ""
                                            }
                                        </td>
                                    </tr>
                                </table>
                                `
                                    : ""
                                }
                                
                                ${
                                  details.length > 0
                                    ? `
                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                    <tr>
                                        <td style="background-color: #f8fafc; border-radius: 12px; padding: 25px; margin-bottom: 30px;">
                                            <h3 style="margin: 0 0 20px 0; color: #1f2937; font-size: 18px; font-weight: 600; text-align: center;">📋 Transaction Details</h3>
                                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" class="detail-grid">
                                                ${details
                                                  .map(
                                                    (detail, index) => `
                                                <tr>
                                                    <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;" class="detail-item">
                                                        <div style="display: flex; justify-content: space-between; align-items: center;">
                                                            <span style="color: #6b7280; font-size: 14px; font-weight: 500;">${detail.label}</span>
                                                            <span style="color: #1f2937; font-size: 16px; font-weight: 600;">${detail.value}</span>
                                                        </div>
                                                    </td>
                                                </tr>
                                                `
                                                  )
                                                  .join("")}
                                            </table>
                                        </td>
                                    </tr>
                                </table>
                                `
                                    : ""
                                }
                                
                                ${
                                  actionButton
                                    ? `
                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                    <tr>
                                        <td style="text-align: center; padding-bottom: 30px;">
                                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin: 0 auto;">
                                                <tr>
                                                    <td style="text-align: center;">
                                                        <a href="${
                                                          actionUrl || "#"
                                                        }" style="display: inline-block; background: linear-gradient(135deg, ${
                                        transactionType === "success"
                                          ? "#059669 0%, #0d9488 100%"
                                          : transactionType === "failed"
                                          ? "#dc2626 0%, #b91c1c 100%"
                                          : "#0ea5e9 0%, #0284c7 100%"
                                      }); color: #ffffff; text-decoration: none; padding: 16px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;" class="cta-button">
                                                            ${actionButton}
                                                        </a>
                                                    </td>
                                                </tr>
                                            </table>
                                        </td>
                                    </tr>
                                </table>
                                `
                                    : ""
                                }
                                
                                ${
                                  footerNote
                                    ? `
                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                    <tr>
                                        <td style="background-color: #f0f9ff; border-left: 4px solid #0ea5e9; padding: 20px; border-radius: 0 8px 8px 0;">
                                            <p style="margin: 0; color: #0c4a6e; font-size: 14px; line-height: 1.5;">${footerNote}</p>
                                        </td>
                                    </tr>
                                </table>
                                `
                                    : ""
                                }
                            </td>
                        </tr>
                    </table>
                </td>
            </tr>
        </table>
    </body>
    </html>
  `,

  course: ({
    userName,
    title,
    subtitle,
    message,
    courseType,
    courseName = null,
    instructorName = null,
    progress = null,
    certificateUrl = null,
    courseUrl = null,
    actionButton,
    actionUrl,
    suggestions = [],
    achievements = [],
  }) => `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width,initial-scale=1">
        <meta name="x-apple-disable-message-reformatting">
        <title>${title} - Educademy</title>
        <style>
            table, td, div, h1, h2, h3, p, a, span {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            }
            table { border-collapse: collapse !important; }
            body { margin: 0 !important; padding: 0 !important; width: 100% !important; background-color: #f7f9fc; }
            
            @media (prefers-color-scheme: dark) {
                .email-container { background-color: #1a1a1a !important; }
                .email-body { background-color: #2d2d2d !important; color: #ffffff !important; }
                .course-header { background: linear-gradient(135deg, #7c3aed 0%, #a855f7 100%) !important; }
                .course-card { background-color: #374151 !important; border: 1px solid #4b5563 !important; }
            }
            
            @media screen and (max-width: 600px) {
                .email-container { width: 100% !important; max-width: 100% !important; }
                .content-padding { padding-left: 20px !important; padding-right: 20px !important; }
                .cta-button { width: 90% !important; font-size: 16px !important; padding: 15px 20px !important; }
                .course-info { display: block !important; }
                .course-item { display: block !important; width: 100% !important; margin-bottom: 15px !important; }
            }
        </style>
    </head>
    <body style="margin: 0; padding: 0; background-color: #f7f9fc;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" class="email-container">
            <tr>
                <td style="padding: 20px 0; text-align: center;">
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="margin: 0 auto; max-width: 600px; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.1);" class="email-body">
                        
                        <tr>
                            <td style="background: linear-gradient(135deg, ${
                              courseType === "published"
                                ? "#059669 0%, #0d9488 100%"
                                : courseType === "rejected"
                                ? "#dc2626 0%, #b91c1c 100%"
                                : courseType === "completed"
                                ? "#f59e0b 0%, #d97706 100%"
                                : "#7c3aed 0%, #a855f7 100%"
                            }); padding: 40px 30px; text-align: center; border-radius: 12px 12px 0 0;" class="course-header">
                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                    <tr>
                                        <td style="text-align: center; padding-bottom: 20px;">
                                            <div style="display: inline-block; background-color: rgba(255,255,255,0.2); padding: 15px; border-radius: 50%;">
                                                <div style="width: 50px; height: 50px; background-color: #ffffff; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;">
                                                    <span style="font-size: 24px;">${
                                                      courseType === "published"
                                                        ? "🎉"
                                                        : courseType ===
                                                          "rejected"
                                                        ? "❌"
                                                        : courseType ===
                                                          "completed"
                                                        ? "🏆"
                                                        : courseType ===
                                                          "enrolled"
                                                        ? "📚"
                                                        : "🎓"
                                                    }</span>
                                                </div>
                                            </div>
                                        </td>
                                    </tr>
                                </table>
                                <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 700; line-height: 1.2;">${title}</h1>
                                <p style="margin: 10px 0 0 0; color: rgba(255,255,255,0.9); font-size: 16px; line-height: 1.5;">${subtitle}</p>
                            </td>
                        </tr>
                        
                        <tr>
                            <td style="padding: 40px 30px;" class="content-padding">
                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                    <tr>
                                        <td style="padding-bottom: 30px; text-align: center;">
                                            <h2 style="margin: 0 0 15px 0; color: #1f2937; font-size: 22px; font-weight: 600;">Hi ${userName},</h2>
                                            <p style="margin: 0; color: #4b5563; font-size: 16px; line-height: 1.6;">${message}</p>
                                        </td>
                                    </tr>
                                </table>
                                
                                ${
                                  courseName
                                    ? `
                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                    <tr>
                                        <td style="background-color: #f8fafc; border-radius: 12px; padding: 25px; margin-bottom: 30px;" class="course-card">
                                            <h3 style="margin: 0 0 20px 0; color: #1f2937; font-size: 18px; font-weight: 600; text-align: center;">📖 Course Information</h3>
                                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" class="course-info">
                                                <tr>
                                                    <td style="padding: 12px 0;">
                                                        <div style="color: #6b7280; font-size: 14px; font-weight: 500; margin-bottom: 5px;">Course Name</div>
                                                        <div style="color: #1f2937; font-size: 18px; font-weight: 600;">${courseName}</div>
                                                    </td>
                                                </tr>
                                                ${
                                                  instructorName
                                                    ? `
                                                <tr>
                                                    <td style="padding: 12px 0;">
                                                        <div style="color: #6b7280; font-size: 14px; font-weight: 500; margin-bottom: 5px;">Instructor</div>
                                                        <div style="color: #1f2937; font-size: 16px; font-weight: 600;">${instructorName}</div>
                                                    </td>
                                                </tr>
                                                `
                                                    : ""
                                                }
                                                ${
                                                  progress
                                                    ? `
                                                <tr>
                                                    <td style="padding: 12px 0;">
                                                        <div style="color: #6b7280; font-size: 14px; font-weight: 500; margin-bottom: 10px;">Progress</div>
                                                        <div style="background-color: #e5e7eb; border-radius: 10px; height: 20px; overflow: hidden;">
                                                            <div style="background: linear-gradient(135deg, #7c3aed 0%, #a855f7 100%); height: 100%; width: ${progress}%; border-radius: 10px; transition: width 0.3s ease;"></div>
                                                        </div>
                                                        <div style="color: #7c3aed; font-size: 14px; font-weight: 600; margin-top: 5px; text-align: right;">${progress}% Complete</div>
                                                    </td>
                                                </tr>
                                                `
                                                    : ""
                                                }
                                            </table>
                                        </td>
                                    </tr>
                                </table>
                                `
                                    : ""
                                }
                                
                                ${
                                  actionButton
                                    ? `
                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                    <tr>
                                        <td style="text-align: center; padding-bottom: 30px;">
                                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin: 0 auto;">
                                                <tr>
                                                    <td style="text-align: center;">
                                                        <a href="${
                                                          actionUrl || "#"
                                                        }" style="display: inline-block; background: linear-gradient(135deg, ${
                                        courseType === "published"
                                          ? "#059669 0%, #0d9488 100%"
                                          : courseType === "rejected"
                                          ? "#dc2626 0%, #b91c1c 100%"
                                          : courseType === "completed"
                                          ? "#f59e0b 0%, #d97706 100%"
                                          : "#7c3aed 0%, #a855f7 100%"
                                      }); color: #ffffff; text-decoration: none; padding: 16px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;" class="cta-button">
                                                            ${actionButton}
                                                        </a>
                                                    </td>
                                                </tr>
                                            </table>
                                            ${
                                              certificateUrl
                                                ? `
                                            <p style="margin: 15px 0 0 0; color: #6b7280; font-size: 13px;">
                                                Download certificate: <a href="${certificateUrl}" style="color: #7c3aed; text-decoration: underline;">Click here</a>
                                            </p>
                                            `
                                                : ""
                                            }
                                        </td>
                                    </tr>
                                </table>
                                `
                                    : ""
                                }
                                
                                ${
                                  suggestions.length > 0
                                    ? `
                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                    <tr>
                                        <td style="background-color: #fef2f2; border-left: 4px solid #ef4444; padding: 20px; border-radius: 0 8px 8px 0; margin-bottom: 20px;">
                                            <h4 style="margin: 0 0 12px 0; color: #dc2626; font-size: 16px; font-weight: 600;">💡 Suggestions for Improvement</h4>
                                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                                ${suggestions
                                                  .map(
                                                    (suggestion) => `
                                                <tr>
                                                    <td style="padding: 4px 0;">
                                                        <span style="color: #dc2626; font-weight: 600; margin-right: 8px;">•</span>
                                                        <span style="color: #7f1d1d; font-size: 14px;">${suggestion}</span>
                                                    </td>
                                                </tr>
                                                `
                                                  )
                                                  .join("")}
                                            </table>
                                        </td>
                                    </tr>
                                </table>
                                `
                                    : ""
                                }
                                
                                ${
                                  achievements.length > 0
                                    ? `
                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                    <tr>
                                        <td style="background-color: #ecfdf5; border-left: 4px solid #10b981; padding: 20px; border-radius: 0 8px 8px 0;">
                                            <h4 style="margin: 0 0 12px 0; color: #065f46; font-size: 16px; font-weight: 600;">🏆 Your Achievements</h4>
                                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                                ${achievements
                                                  .map(
                                                    (achievement) => `
                                                <tr>
                                                    <td style="padding: 4px 0;">
                                                        <span style="color: #059669; font-weight: 600; margin-right: 8px;">✓</span>
                                                        <span style="color: #047857; font-size: 14px;">${achievement}</span>
                                                    </td>
                                                </tr>
                                                `
                                                  )
                                                  .join("")}
                                            </table>
                                        </td>
                                    </tr>
                                </table>
                                `
                                    : ""
                                }
                            </td>
                        </tr>
                    </table>
                </td>
            </tr>
        </table>
    </body>
    </html>
  `,

  communication: ({
    userName,
    title,
    subtitle,
    message,
    communicationType,
    senderName = null,
    courseName = null,
    originalContent = null,
    replyContent = null,
    grade = null,
    feedback = null,
    actionButton,
    actionUrl,
    conversationUrl = null,
  }) => `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width,initial-scale=1">
        <meta name="x-apple-disable-message-reformatting">
        <title>${title} - Educademy</title>
        <style>
            table, td, div, h1, h2, h3, p, a, span {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            }
            table { border-collapse: collapse !important; }
            body { margin: 0 !important; padding: 0 !important; width: 100% !important; background-color: #f7f9fc; }
            
            @media (prefers-color-scheme: dark) {
                .email-container { background-color: #1a1a1a !important; }
                .email-body { background-color: #2d2d2d !important; color: #ffffff !important; }
                .communication-header { background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%) !important; }
                .content-card { background-color: #374151 !important; border: 1px solid #4b5563 !important; }
            }
            
            @media screen and (max-width: 600px) {
                .email-container { width: 100% !important; max-width: 100% !important; }
                .content-padding { padding-left: 20px !important; padding-right: 20px !important; }
                .cta-button { width: 90% !important; font-size: 16px !important; padding: 15px 20px !important; }
                .grade-display { font-size: 28px !important; }
            }
        </style>
    </head>
    <body style="margin: 0; padding: 0; background-color: #f7f9fc;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" class="email-container">
            <tr>
                <td style="padding: 20px 0; text-align: center;">
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="margin: 0 auto; max-width: 600px; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.1);" class="email-body">
                        
                        <tr>
                            <td style="background: linear-gradient(135deg, ${
                              communicationType === "graded"
                                ? "#059669 0%, #0d9488 100%"
                                : communicationType === "message"
                                ? "#0ea5e9 0%, #0284c7 100%"
                                : "#6366f1 0%, #8b5cf6 100%"
                            }); padding: 40px 30px; text-align: center; border-radius: 12px 12px 0 0;" class="communication-header">
                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                    <tr>
                                        <td style="text-align: center; padding-bottom: 20px;">
                                            <div style="display: inline-block; background-color: rgba(255,255,255,0.2); padding: 15px; border-radius: 50%;">
                                                <div style="width: 50px; height: 50px; background-color: #ffffff; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;">
                                                    <span style="font-size: 24px;">${
                                                      communicationType ===
                                                      "graded"
                                                        ? "📝"
                                                        : communicationType ===
                                                          "message"
                                                        ? "💬"
                                                        : communicationType ===
                                                          "qa"
                                                        ? "❓"
                                                        : communicationType ===
                                                          "review"
                                                        ? "⭐"
                                                        : "💬"
                                                    }</span>
                                                </div>
                                            </div>
                                        </td>
                                    </tr>
                                </table>
                                <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 700; line-height: 1.2;">${title}</h1>
                                <p style="margin: 10px 0 0 0; color: rgba(255,255,255,0.9); font-size: 16px; line-height: 1.5;">${subtitle}</p>
                            </td>
                        </tr>
                        
                        <tr>
                            <td style="padding: 40px 30px;" class="content-padding">
                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                    <tr>
                                        <td style="padding-bottom: 30px; text-align: center;">
                                            <h2 style="margin: 0 0 15px 0; color: #1f2937; font-size: 22px; font-weight: 600;">Hi ${userName},</h2>
                                            <p style="margin: 0; color: #4b5563; font-size: 16px; line-height: 1.6;">${message}</p>
                                        </td>
                                    </tr>
                                </table>
                                
                                ${
                                  courseName
                                    ? `
                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                    <tr>
                                        <td style="background-color: #f8fafc; border-radius: 8px; padding: 20px; margin-bottom: 30px; text-align: center;">
                                            <h4 style="margin: 0 0 5px 0; color: #6b7280; font-size: 14px; font-weight: 500;">Course</h4>
                                            <div style="color: #1f2937; font-size: 18px; font-weight: 600;">${courseName}</div>
                                            ${
                                              senderName
                                                ? `<div style="color: #6b7280; font-size: 14px; margin-top: 5px;">by ${senderName}</div>`
                                                : ""
                                            }
                                        </td>
                                    </tr>
                                </table>
                                `
                                    : ""
                                }
                                
                                ${
                                  grade
                                    ? `
                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                    <tr>
                                        <td style="background: linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%); border-radius: 12px; padding: 30px; margin-bottom: 30px; text-align: center;" class="content-card">
                                            <h3 style="margin: 0 0 10px 0; color: #065f46; font-size: 16px; font-weight: 500;">Your Grade</h3>
                                            <div style="font-size: 36px; font-weight: 700; color: #059669; margin: 10px 0;" class="grade-display">${grade}</div>
                                            ${
                                              feedback
                                                ? `<p style="margin: 15px 0 0 0; color: #047857; font-size: 14px; line-height: 1.5; font-style: italic;">"${feedback}"</p>`
                                                : ""
                                            }
                                        </td>
                                    </tr>
                                </table>
                                `
                                    : ""
                                }
                                
                                ${
                                  originalContent
                                    ? `
                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                    <tr>
                                        <td style="background-color: #f8fafc; border-radius: 8px; padding: 20px; margin-bottom: 20px;" class="content-card">
                                            <h4 style="margin: 0 0 12px 0; color: #374151; font-size: 14px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px;">
                                                ${
                                                  communicationType === "qa"
                                                    ? "Your Question"
                                                    : communicationType ===
                                                      "review"
                                                    ? "Your Review"
                                                    : "Original Message"
                                                }
                                            </h4>
                                            <div style="color: #4b5563; font-size: 15px; line-height: 1.6; background-color: #ffffff; padding: 15px; border-radius: 6px; border-left: 3px solid #6366f1;">
                                                ${originalContent}
                                            </div>
                                        </td>
                                    </tr>
                                </table>
                                `
                                    : ""
                                }
                                
                                ${
                                  replyContent
                                    ? `
                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                    <tr>
                                        <td style="background-color: #eff6ff; border-radius: 8px; padding: 20px; margin-bottom: 30px;" class="content-card">
                                            <h4 style="margin: 0 0 12px 0; color: #1e40af; font-size: 14px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px;">
                                                ${
                                                  communicationType === "qa"
                                                    ? "Instructor Answer"
                                                    : communicationType ===
                                                      "review"
                                                    ? "Reply"
                                                    : "New Message"
                                                }
                                            </h4>
                                            <div style="color: #1f2937; font-size: 15px; line-height: 1.6; background-color: #ffffff; padding: 15px; border-radius: 6px; border-left: 3px solid #0ea5e9;">
                                                ${replyContent}
                                            </div>
                                            ${
                                              senderName
                                                ? `<p style="margin: 12px 0 0 0; color: #6b7280; font-size: 13px; text-align: right;">— ${senderName}</p>`
                                                : ""
                                            }
                                        </td>
                                    </tr>
                                </table>
                                `
                                    : ""
                                }
                                
                                ${
                                  actionButton
                                    ? `
                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                    <tr>
                                        <td style="text-align: center; padding-bottom: 30px;">
                                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin: 0 auto;">
                                                <tr>
                                                    <td style="text-align: center;">
                                                        <a href="${
                                                          actionUrl || "#"
                                                        }" style="display: inline-block; background: linear-gradient(135deg, ${
                                        communicationType === "graded"
                                          ? "#059669 0%, #0d9488 100%"
                                          : communicationType === "message"
                                          ? "#0ea5e9 0%, #0284c7 100%"
                                          : "#6366f1 0%, #8b5cf6 100%"
                                      }); color: #ffffff; text-decoration: none; padding: 16px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;" class="cta-button">
                                                            ${actionButton}
                                                        </a>
                                                    </td>
                                                </tr>
                                            </table>
                                            ${
                                              conversationUrl
                                                ? `
                                            <p style="margin: 15px 0 0 0; color: #6b7280; font-size: 13px;">
                                                View full conversation: <a href="${conversationUrl}" style="color: #6366f1; text-decoration: underline;">Click here</a>
                                            </p>
                                            `
                                                : ""
                                            }
                                        </td>
                                    </tr>
                                </table>
                                `
                                    : ""
                                }
                            </td>
                        </tr>
                    </table>
                </td>
            </tr>
        </table>
    </body>
    </html>
  `,

  system: ({
    userName,
    title,
    subtitle,
    message,
    systemType,
    maintenanceWindow = null,
    downloadUrl = null,
    expiryDate = null,
    ticketId = null,
    actionButton,
    actionUrl,
    additionalInfo = [],
    isUrgent = false,
  }) => `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width,initial-scale=1">
        <meta name="x-apple-disable-message-reformatting">
        <title>${title} - Educademy</title>
        <style>
            table, td, div, h1, h2, h3, p, a, span {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            }
            table { border-collapse: collapse !important; }
            body { margin: 0 !important; padding: 0 !important; width: 100% !important; background-color: #f7f9fc; }
            
            @media (prefers-color-scheme: dark) {
                .email-container { background-color: #1a1a1a !important; }
                .email-body { background-color: #2d2d2d !important; color: #ffffff !important; }
                .system-header { background: linear-gradient(135deg, #6b7280 0%, #9ca3af 100%) !important; }
                .info-card { background-color: #374151 !important; border: 1px solid #4b5563 !important; }
            }
            
            @media screen and (max-width: 600px) {
                .email-container { width: 100% !important; max-width: 100% !important; }
                .content-padding { padding-left: 20px !important; padding-right: 20px !important; }
                .cta-button { width: 90% !important; font-size: 16px !important; padding: 15px 20px !important; }
                .maintenance-time { font-size: 18px !important; }
            }
        </style>
    </head>
    <body style="margin: 0; padding: 0; background-color: #f7f9fc;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" class="email-container">
            <tr>
                <td style="padding: 20px 0; text-align: center;">
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" style="margin: 0 auto; max-width: 600px; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.1);" class="email-body">
                        
                        <tr>
                            <td style="background: linear-gradient(135deg, ${
                              isUrgent
                                ? "#dc2626 0%, #b91c1c 100%"
                                : systemType === "maintenance"
                                ? "#f59e0b 0%, #d97706 100%"
                                : systemType === "support"
                                ? "#0ea5e9 0%, #0284c7 100%"
                                : "#6b7280 0%, #9ca3af 100%"
                            }); padding: 40px 30px; text-align: center; border-radius: 12px 12px 0 0;" class="system-header">
                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                    <tr>
                                        <td style="text-align: center; padding-bottom: 20px;">
                                            <div style="display: inline-block; background-color: rgba(255,255,255,0.2); padding: 15px; border-radius: 50%;">
                                                <div style="width: 50px; height: 50px; background-color: #ffffff; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;">
                                                    <span style="font-size: 24px;">${
                                                      systemType ===
                                                      "maintenance"
                                                        ? "🔧"
                                                        : systemType ===
                                                          "export"
                                                        ? "📄"
                                                        : systemType ===
                                                          "support"
                                                        ? "🎫"
                                                        : systemType === "terms"
                                                        ? "📋"
                                                        : "⚙️"
                                                    }</span>
                                                </div>
                                            </div>
                                        </td>
                                    </tr>
                                </table>
                                <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 700; line-height: 1.2;">${title}</h1>
                                <p style="margin: 10px 0 0 0; color: rgba(255,255,255,0.9); font-size: 16px; line-height: 1.5;">${subtitle}</p>
                            </td>
                        </tr>
                        
                        <tr>
                            <td style="padding: 40px 30px;" class="content-padding">
                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                    <tr>
                                        <td style="padding-bottom: 30px; text-align: center;">
                                            <h2 style="margin: 0 0 15px 0; color: #1f2937; font-size: 22px; font-weight: 600;">Hi ${userName},</h2>
                                            <p style="margin: 0; color: #4b5563; font-size: 16px; line-height: 1.6;">${message}</p>
                                        </td>
                                    </tr>
                                </table>
                                
                                ${
                                  maintenanceWindow
                                    ? `
                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                    <tr>
                                        <td style="background-color: #fef3c7; border-radius: 12px; padding: 25px; margin-bottom: 30px; text-align: center;" class="info-card">
                                            <h3 style="margin: 0 0 15px 0; color: #92400e; font-size: 18px; font-weight: 600;">🕐 Maintenance Schedule</h3>
                                            <div style="color: #78350f; font-size: 20px; font-weight: 600; margin: 10px 0;" class="maintenance-time">${maintenanceWindow}</div>
                                            <p style="margin: 10px 0 0 0; color: #92400e; font-size: 14px;">Please plan accordingly as the platform will be temporarily unavailable</p>
                                        </td>
                                    </tr>
                                </table>
                                `
                                    : ""
                                }
                                
                                ${
                                  ticketId
                                    ? `
                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                    <tr>
                                        <td style="background-color: #f0f9ff; border-radius: 8px; padding: 20px; margin-bottom: 30px; text-align: center;">
                                            <h4 style="margin: 0 0 10px 0; color: #1e40af; font-size: 14px; font-weight: 500;">Support Ticket</h4>
                                            <div style="color: #1f2937; font-size: 18px; font-weight: 600; font-family: 'Courier New', monospace;">#${ticketId}</div>
                                        </td>
                                    </tr>
                                </table>
                                `
                                    : ""
                                }
                                
                                ${
                                  downloadUrl
                                    ? `
                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                    <tr>
                                        <td style="background-color: #ecfdf5; border-left: 4px solid #10b981; padding: 20px; border-radius: 0 8px 8px 0; margin-bottom: 30px;">
                                            <h4 style="margin: 0 0 12px 0; color: #065f46; font-size: 16px; font-weight: 600;">📥 Download Ready</h4>
                                            <p style="margin: 0 0 15px 0; color: #047857; font-size: 14px; line-height: 1.5;">Your data export is ready for download. Please download it within 7 days.</p>
                                            <a href="${downloadUrl}" style="display: inline-block; background: linear-gradient(135deg, #059669 0%, #0d9488 100%); color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: 600; font-size: 14px;">Download Now</a>
                                            ${
                                              expiryDate
                                                ? `<p style="margin: 15px 0 0 0; color: #047857; font-size: 12px;">Expires on: ${expiryDate}</p>`
                                                : ""
                                            }
                                        </td>
                                    </tr>
                                </table>
                                `
                                    : ""
                                }
                                
                                ${
                                  additionalInfo.length > 0
                                    ? `
                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                    <tr>
                                        <td style="background-color: #f8fafc; border-radius: 8px; padding: 20px; margin-bottom: 30px;">
                                            <h4 style="margin: 0 0 15px 0; color: #374151; font-size: 16px; font-weight: 600;">Additional Information</h4>
                                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                                ${additionalInfo
                                                  .map(
                                                    (info) => `
                                                <tr>
                                                    <td style="padding: 8px 0;">
                                                        <span style="color: #6b7280; font-weight: 600; margin-right: 8px;">•</span>
                                                        <span style="color: #4b5563; font-size: 15px;">${info}</span>
                                                    </td>
                                                </tr>
                                                `
                                                  )
                                                  .join("")}
                                            </table>
                                        </td>
                                    </tr>
                                </table>
                                `
                                    : ""
                                }
                                
                                ${
                                  actionButton
                                    ? `
                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                    <tr>
                                        <td style="text-align: center; padding-bottom: 30px;">
                                            <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin: 0 auto;">
                                                <tr>
                                                    <td style="text-align: center;">
                                                        <a href="${
                                                          actionUrl || "#"
                                                        }" style="display: inline-block; background: linear-gradient(135deg, ${
                                        isUrgent
                                          ? "#dc2626 0%, #b91c1c 100%"
                                          : systemType === "maintenance"
                                          ? "#f59e0b 0%, #d97706 100%"
                                          : systemType === "support"
                                          ? "#0ea5e9 0%, #0284c7 100%"
                                          : "#6b7280 0%, #9ca3af 100%"
                                      }); color: #ffffff; text-decoration: none; padding: 16px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;" class="cta-button">
                                                            ${actionButton}
                                                        </a>
                                                    </td>
                                                </tr>
                                            </table>
                                        </td>
                                    </tr>
                                </table>
                                `
                                    : ""
                                }
                                
                                ${
                                  isUrgent
                                    ? `
                                <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                                    <tr>
                                        <td style="background-color: #fef2f2; border-left: 4px solid #ef4444; padding: 20px; border-radius: 0 8px 8px 0;">
                                            <p style="margin: 0; color: #7f1d1d; font-size: 14px; line-height: 1.5;"><strong>⚠️ Urgent:</strong> This notification requires immediate attention. Please take action as soon as possible.</p>
                                        </td>
                                    </tr>
                                </table>
                                `
                                    : ""
                                }
                            </td>
                        </tr>
                    </table>
                </td>
            </tr>
        </table>
    </body>
    </html>
  `,
};

export default emailTemplates;

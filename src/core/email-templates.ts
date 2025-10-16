import { formatOrderIdForDisplay } from "./utils";

// --- INTERFACES DE DADOS (Props) ---
interface WelcomeEmailProps {
  firstName: string;
  saudacao: string;
  pronomeObjeto: string;
}
interface PickerRegistrationReceivedProps {
  firstName: string;
}
interface EmailChangeProps {
  verificationLink: string;
}
interface SecurityAlertProps {
  newEmail: string;
}
interface LayoutProps {
  title: string;
  preheaderText: string;
  bodyContent: string;
}
interface ButtonProps {
  href: string;
  text: string;
}
interface PasswordResetProps {
  resetLink: string;
  firstName: string;
}
interface DietStatusUpdateProps {
  firstName: string;
}
interface DeliveryProgressProps {
  firstName: string;
  address: {
    street: string;
    number: string;
    neighborhood: string;
    city: string;
    state: string;
  };
  driver?: {
    name?: string;
    vehicle?: string;
    licensePlate?: string;
    eta?: string;
  }
}
interface PaymentApprovedProps {
  firstName: string;
  orderId: string;
  totalPaid: number;
}
interface PendingPaymentEmailProps {
  firstName: string;
  orderId: string;
  totalPrice: number;
  pixCopiaECola: string;
  qrCodeImageUrl: string;
}
interface NotifyingPickerProps {
  firstName: string;
}
interface CancelledEmailProps {
  firstName: string;
  orderId: string;
  reason: string;
}
interface ReturnRequestReceivedProps {
  firstName: string;
  orderId: string;
}
interface SubstitutionEmailProps {
  firstName: string;
  orderId: string;
  originalFoodName: string;
  substituteFoodName: string;
}
interface NewSupportTicketProps {
  userName: string;
  userEmail: string;
  orderId: string;
  ticketSubject: string;
  ticketMessage: string;
  ticketLink: string;
}
interface SupportReplyNotificationProps {
  firstName: string;
}
interface NewSupportMessageProps {
  userFullName: string;
  dietId: string;
  adminPanelLink: string;
}
interface RefundEmailParams {
  firstName: string;
  orderId: string;
  refundAmount: number;
}
interface AutoCancelEmailParams {
  firstName: string;
  orderId: string;
  refundAmount: number;
}

// Adicione esta interface junto com as outras
interface NewProblemReportAlertProps {
  dietId: string;
  reportId: string;
  pickerName: string;
  category: string;
  description: string;
  adminPanelLink: string;
}

interface SeparationDelayedWarningProps {
  pickerFirstName: string;
  orderIdShort: string; // Alterado de orderIdFormatted
  customerName: string;
}

interface SeparationFinalWarningProps {
  pickerFirstName: string;
  orderIdShort: string; // Alterado de orderIdFormatted
  customerName: string;
}

interface AdminRefundAlertProps {
  orderIdFormatted: string;
  customerName: string;
  reason: string;
  refundAmount: number;
  adminPanelLink: string;
}

interface DelayedDeliveryEmailProps {
  firstName: string;
  deliveryDay: string;
}

interface ScheduledDeliveryReminderProps {
  firstName: string;
}

interface SupportInitiatedContactProps {
  firstName: string;
  orderId: string;
}

interface PersonalDataChangedAlertProps {
  firstName: string;
}

interface AccountDeletionProps {
  firstName: string;
}

interface AccountReactivatedProps {
  firstName: string;
}

interface QueueAvailableProps {
  firstName: string;
}

interface RegionAvailableProps {
  firstName: string;
  cityName: string;
}

interface NextDayAvailableProps {
  firstName: string;
}

interface PickerProblemApologyEmailProps {
  firstName: string;
  orderId: string;
}

interface NewUserAdminAlertProps {
  userName: string;
  userEmail: string;
  userId: string;
  adminPanelLink: string;
}

interface PickerSupportConfirmationProps {
  firstName: string;
  subject: string;
}

interface PendingPaymentReminderEmailProps {
  firstName: string;
  orderId: string;
  totalPrice: number;
  paymentLink: string; // Link direto para a página de pedidos
  optimizationLink: string; // Link especial para otimização
}

// --- COMPONENTES REUTILIZÁVEIS ---

const capitalizeName = (name: string): string => {
  if (!name) return '';
  return name
    .toLowerCase()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};

const createButtonHTML = (props: ButtonProps): string => {
  const { href, text } = props;
  return `
    <a href="${href}" target="_blank" style="display: inline-block; background-color: #18181b; color: #ffffff; font-family: Arial, sans-serif; font-size: 16px; font-weight: bold; padding: 14px 28px; text-decoration: none; border-radius: 999px;">
      ${text}
    </a>
  `;
};

const createOptimizationButtonHTML = (href: string): string => {
  return `
    <a href="${href}" target="_blank" style="display: inline-block; background-color: #7c3aed; color: #ffffff; font-family: Arial, sans-serif; font-size: 16px; font-weight: bold; padding: 14px 28px; text-decoration: none; border-radius: 999px; border: none;">
      <span style="vertical-align: middle;">🔮</span>
      <span style="vertical-align: middle; margin-left: 8px;">Otimizar Preço com IA</span>
    </a>
  `;
};

const createEmailLayout = (props: LayoutProps): string => {
  const { title, preheaderText, bodyContent } = props;
  return `
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${title}</title>
      <style>
        body { margin: 0; padding: 0; background-color: #ffffff; }
        table { border-collapse: collapse; }
        .content-cell { padding: 32px 40px; }
        @media screen and (max-width: 600px) {
          .content-cell { padding: 24px; }
        }
      </style>
    </head>
    <body>
      <span style="display:none;font-size:1px;color:#ffffff;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">
        ${preheaderText}
      </span>
      <table width="100%" border="0" cellspacing="0" cellpadding="0">
        <tr>
          <td align="center">
            <table width="600" border="0" cellspacing="0" cellpadding="0" style="max-width: 600px; width: 100%; margin: 20px 0;">
              <tr>
                <td align="left" class="content-cell" style="background-color: #ffffff; border-radius: 8px; border: 1px solid #e2e8f0;">
                  ${bodyContent}
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;
};

// --- TEMPLATES DE E-MAIL PÚBLICOS ---

export const getWelcomeEmailHTML = (props: WelcomeEmailProps): string => {
  
  const { firstName, saudacao, pronomeObjeto } = props;
  const bodyContent = `
    <h1 style="font-size: 24px; color: #111; font-family: Arial, sans-serif; margin-top: 0;">${saudacao}, ${firstName}!</h1>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">A sua conta na <strong>colormind</strong> foi criada com sucesso. Estamos muito felizes por ${pronomeObjeto} conosco na sua jornada para uma dieta otimizada.</p>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">O nosso sistema já está analisando as suas informações para começar a montar a sua dieta personalizada. Em breve, você terá acesso a tudo na sua área de perfil.</p>
    <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin: 30px 0;">
      <tr><td align="center">${createButtonHTML({ href: 'https://colormind.com.br/', text: 'Montar minha dieta' })}</td></tr>
    </table>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Se tiver alguma dúvida, não hesite em entrar em contato pelo site!</p>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Atenciosamente,<br>Equipe colormind</p>
  `;
  return createEmailLayout({
    title: `Bem-vindo(a) à colormind, ${firstName}!`,
    preheaderText: 'Sua conta foi criada com sucesso. Vamos começar sua jornada!',
    bodyContent: bodyContent
  });
};

export const getNewUserAdminAlertEmailHTML = (props: NewUserAdminAlertProps): string => {
  const { userName, userEmail, userId, adminPanelLink } = props;
  const bodyContent = `
    <h2 style="font-size: 22px; color: #111; font-family: Arial, sans-serif; margin-top: 0;">Novo Utilizador Registado!</h2>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Um novo utilizador acaba de concluir o registo na plataforma <strong>colormind</strong>.</p>
    
    <div style="background-color: #f8f8f8; padding: 16px; border-radius: 8px; margin: 24px 0; font-family: Arial, sans-serif; border-left: 3px solid #84cc16;">
      <p style="margin: 0 0 10px 0;"><strong>Nome:</strong> ${userName}</p>
      <p style="margin: 0 0 10px 0;"><strong>E-mail:</strong> ${userEmail}</p>
      <p style="margin: 0;"><strong>User ID:</strong> ${userId}</p>
    </div>

    <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin: 30px 0;">
      <tr>
        <td align="center">
          ${createButtonHTML({ href: adminPanelLink, text: 'Ver Perfil no Painel Admin' })}
        </td>
      </tr>
    </table>
  `;

  return createEmailLayout({
    title: `Novo Registo: ${userName}`,
    preheaderText: `O utilizador ${userEmail} completou o registo.`,
    bodyContent: bodyContent
  });
};

export const getPendingPaymentEmailHTML = (props: PendingPaymentEmailProps): string => {
  const { firstName, orderId, totalPrice, pixCopiaECola, qrCodeImageUrl } = props;
  const formattedTotal = totalPrice.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const formattedId = formatOrderIdForDisplay(orderId);

  
  const nonLinkablePixCode = pixCopiaECola.replace(/\./g, '&#8203;.');
  
  
  const bodyContent = `
    <h2 style="font-size: 22px; color: #111; font-family: Arial, sans-serif; margin-top: 0;">Seu pedido ${formattedId} está pronto!</h2>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Olá, ${firstName},</p>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">O último passo para começar sua jornada é confirmar o pagamento de ${formattedTotal}.</p>
    <div style="margin: 24px 0; text-align: center;">
      <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Aponte a câmera do seu celular para o QR Code abaixo:</p>
      <div style="background-color: #ffffff; padding: 8px; border: 1px solid #e2e8f0; border-radius: 8px; display: inline-block; margin-top: 10px;">
        <img src="${qrCodeImageUrl}" alt="QR Code PIX" style="width: 200px; height: 200px; display: block;">
      </div>
    </div>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Se preferir, use o código Copia e Cola abaixo. Este código é válido por 1 hora.</p>
    <div style="background-color: #f8f8f8; padding: 16px; border-radius: 8px; text-align: center; margin: 24px 0;">
      <p style="font-family: monospace; font-size: 12px; color: #333333 !important; text-decoration: none !important; word-break: break-all; margin: 0;">${nonLinkablePixCode}</p>
    </div>
    <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin: 30px 0;">
      <tr><td align="center">${createButtonHTML({ href: `https://colormind.com.br/profile?section=diets`, text: 'Ver Detalhes do Pedido' })}</td></tr>
    </table>
  `;
  return createEmailLayout({
    title: `Seu pedido ${formattedId} está pronto para pagamento!`,
    preheaderText: `O total é ${formattedTotal}. Realize o pagamento para iniciarmos a separação.`,
    bodyContent: bodyContent
  });
};

export const getNotifyingPickerEmailHTML = (props: NotifyingPickerProps): string => {
  const { firstName } = props;
  const bodyContent = `
    <h2 style="font-size: 22px; color: #111; font-family: Arial, sans-serif; margin-top: 0;">O próximo passo já começou!</h2>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Olá, ${firstName},</p>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Seu pagamento foi confirmado com sucesso e sua dieta já entrou na nossa fila de separação. O nosso sistema já está a notificar a nossa equipe de pickers.</p>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Você receberá uma nova notificação assim que um dos nossos especialistas começar a separar os seus ingredientes frescos.</p>
    <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin: 30px 0;">
      <tr><td align="center">${createButtonHTML({ href: `https://colormind.com.br/profile?section=diets`, text: 'Acompanhar Pedido' })}</td></tr>
    </table>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Fique atento às próximas atualizações!</p>
  `;
  return createEmailLayout({
    title: 'Estamos a encontrar um Picker para si!',
    preheaderText: 'Seu pedido foi confirmado e já estamos a trabalhar no próximo passo.',
    bodyContent: bodyContent
  });
};

export const getCancelledEmailHTML = (props: CancelledEmailProps): string => {
  const { firstName, orderId, reason } = props;
  const formattedId = formatOrderIdForDisplay(orderId);
  const bodyContent = `
    <h2 style="font-size: 22px; color: #111; font-family: Arial, sans-serif; margin-top: 0;">Seu pedido ${formattedId} foi cancelado</h2>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Olá, ${firstName},</p>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Informamos que seu pedido <strong>${formattedId}</strong> foi cancelado em nosso sistema.</p>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;"><strong>Motivo:</strong> ${reason}</p>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Se você ainda deseja receber sua dieta, não se preocupe! Basta criar um novo pedido em nosso site.</p>
    <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin: 30px 0;">
      <tr><td align="center">${createButtonHTML({ href: 'https://colormind.com.br/', text: 'Montar uma Nova Dieta' })}</td></tr>
    </table>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Se você acredita que isso foi um erro, por favor, entre em contato com nosso suporte.</p>
  `;
  return createEmailLayout({
    title: `Seu pedido ${formattedId} foi cancelado`,
    preheaderText: `Houve um problema com seu pedido e ele foi cancelado.`,
    bodyContent: bodyContent
  });
};

export const getNewEmailConfirmationHTML = (props: EmailChangeProps): string => {
  const { verificationLink } = props;
  const bodyContent = `
    <h2 style="font-size: 22px; color: #111; font-family: Arial, sans-serif; margin-top: 0;">Confirme seu novo e-mail</h2>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Olá,</p>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Recebemos uma solicitação para alterar o e-mail da sua conta para este endereço. Para confirmar, clique no botão abaixo. Este link é válido por 1 hora.</p>
    <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin: 30px 0;">
      <tr><td align="center">${createButtonHTML({ href: verificationLink, text: 'Confirmar Novo E-mail' })}</td></tr>
    </table>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Se você não solicitou esta alteração, pode ignorar este e-mail com segurança.</p>
  `;
  return createEmailLayout({
    title: 'Confirmação de Alteração de E-mail',
    preheaderText: 'Clique para confirmar seu novo endereço de e-mail.',
    bodyContent: bodyContent
  });
};

export const getOldEmailSecurityAlertHTML = (props: SecurityAlertProps): string => {
  const { newEmail } = props;
  const bodyContent = `
    <h2 style="font-size: 22px; color: #111; font-family: Arial, sans-serif; margin-top: 0;">Alerta de Segurança da Conta</h2>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Olá,</p>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Este é um aviso de que uma solicitação foi feita para alterar o e-mail da sua conta para o novo endereço abaixo:</p>
    <p style="font-family: Arial, sans-serif; font-size: 18px; text-align: center; background-color: #f0f0f0; padding: 12px; border-radius: 5px; color: #333; font-weight: bold;">${newEmail}</p>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Um e-mail de confirmação foi enviado ao novo endereço. Sua alteração só será concluída se o link nesse outro e-mail for clicado.</p>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #c0392b; font-weight: bold; border-top: 1px solid #eee; padding-top: 20px; margin-top: 20px;">Se você NÃO fez esta solicitação, sua conta pode ter sido acessada por outra pessoa. Recomendamos que você altere sua senha imediatamente.</p>
  `;
  return createEmailLayout({
    title: 'Alerta de Segurança: Tentativa de Alteração de E-mail',
    preheaderText: 'Uma solicitação de alteração de e-mail foi feita para sua conta.',
    bodyContent: bodyContent
  });
};

export const getPersonalDataChangedAlertEmailHTML = (props: PersonalDataChangedAlertProps): string => {
  const { firstName } = props;
  const bodyContent = `
    <h2 style="font-size: 22px; color: #111; font-family: Arial, sans-serif; margin-top: 0;">Alerta de Segurança: Dados Pessoais Alterados</h2>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Olá, ${firstName},</p>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Este é um aviso para confirmar que suas informações pessoais (como nome, CPF ou data de nascimento) foram atualizadas em sua conta na <strong>colormind</strong>.</p>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #c0392b; font-weight: bold; border-top: 1px solid #eee; padding-top: 20px; margin-top: 20px;">Se você NÃO fez esta alteração, sua conta pode ter sido acessada por outra pessoa. Por favor, entre em contato com nosso suporte imediatamente e altere sua senha.</p>
    <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin: 30px 0;">
      <tr><td align="center">${createButtonHTML({ href: 'https://colormind.com.br/profile', text: 'Ver Meu Perfil' })}</td></tr>
    </table>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Se foi você mesmo quem fez a alteração, pode ignorar este e-mail com segurança.</p>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Atenciosamente,<br>Equipe colormind</p>
  `;
  return createEmailLayout({
    title: 'Alerta de Segurança: Seus Dados Pessoais Foram Alterados',
    preheaderText: 'Suas informações como nome e CPF foram atualizadas. Se não foi você, contate o suporte.',
    bodyContent: bodyContent
  });
};

export const getPasswordResetEmailHTML = (props: PasswordResetProps): string => {
  const { resetLink, firstName } = props;
  const bodyContent = `
    <h2 style="font-size: 22px; color: #111; font-family: Arial, sans-serif; margin-top: 0;">Redefina sua senha</h2>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Olá, ${firstName},</p>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Recebemos uma solicitação para redefinir a senha da sua conta. Se foi você, clique no botão abaixo para escolher uma nova senha. Este link é válido por 1 hora.</p>
    <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin: 30px 0;">
      <tr><td align="center">${createButtonHTML({ href: resetLink, text: 'Redefinir Senha' })}</td></tr>
    </table>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Se você não fez esta solicitação, pode ignorar este e-mail com segurança.</p>
  `;
  return createEmailLayout({
    title: 'Recuperação de Senha - colormind',
    preheaderText: 'Siga as instruções para criar uma nova senha para sua conta.',
    bodyContent: bodyContent
  });
};

export const getPaymentApprovedEmailHTML = (props: PaymentApprovedProps): string => {
  const { firstName, orderId, totalPaid } = props;
  const formattedTotal = totalPaid.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const formattedId = formatOrderIdForDisplay(orderId);
  const bodyContent = `
    <h2 style="font-size: 22px; color: #111; font-family: Arial, sans-serif; margin-top: 0;">Pagamento Aprovado!</h2>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Olá, ${firstName},</p>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Ótima notícia! Confirmamos o recebimento do seu pagamento e seu pedido já está sendo processado.</p>
    <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin: 24px 0;">
      <tr>
        <td style="background-color: #f8f8f8; padding: 16px; border-left: 3px solid #18181b; font-family: Arial, sans-serif;">
          <p style="margin: 0; font-size: 14px; color: #555555;">Pedido: <strong style="color: #111;">${formattedId}</strong></p>
          <p style="margin: 8px 0 0; font-size: 14px; color: #555555;">Total Pago: <strong style="color: #111;">${formattedTotal}</strong></p>
        </td>
      </tr>
    </table>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Nossa equipe já foi notificada e em breve começará a separar os ingredientes frescos para a sua dieta. O próximo passo é a confirmação do pedido.</p>
    <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin: 30px 0;">
      <tr><td align="center">${createButtonHTML({ href: `https://colormind.com.br/profile?section=diets`, text: 'Acompanhar Meu Pedido' })}</td></tr>
    </table>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Agradecemos pela sua confiança!</p>
  `;
  return createEmailLayout({
    title: `Pagamento Confirmado - Pedido ${formattedId}`,
    preheaderText: `Recebemos seu pagamento de ${formattedTotal}. Já estamos preparando tudo por aqui!`,
    bodyContent: bodyContent
  });
};

export const getPendingPaymentReminderEmailHTML = (props: PendingPaymentReminderEmailProps): string => {
  const { firstName, orderId, totalPrice, paymentLink, optimizationLink } = props;
  const formattedTotal = totalPrice.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const formattedId = formatOrderIdForDisplay(orderId);

  const bodyContent = `
    <h2 style="font-size: 22px; color: #111; font-family: Arial, sans-serif; margin-top: 0;">Esqueceu algo? Finalize seu pedido ${formattedId}</h2>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Olá, ${firstName},</p>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Notamos que você ainda não finalizou o pagamento da sua dieta no valor de <strong>${formattedTotal}</strong>. Falta pouco para começar sua jornada de alimentação otimizada!</p>
    
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555; margin-top: 24px;">Se o valor não está ideal para você, temos uma boa notícia! Nossa IA pode tentar ajustar os ingredientes para encontrar um preço melhor, sem comprometer a qualidade.</p>
    
    <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin: 30px 0;">
      <tr>
        <td align="center">
          ${createOptimizationButtonHTML(optimizationLink)}
        </td>
      </tr>
    </table>

    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Ou, se preferir manter a seleção original, você pode finalizar o pagamento a qualquer momento clicando abaixo.</p>

    <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin: 20px 0 30px 0;">
      <tr>
        <td align="center">
          ${createButtonHTML({ href: paymentLink, text: 'Pagar ' + formattedTotal + ' Agora' })}
        </td>
      </tr>
    </table>
    
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Se tiver alguma dúvida, nosso suporte está à disposição.</p>
  `;

  return createEmailLayout({
    title: `Finalize sua dieta - Pedido ${formattedId}`,
    preheaderText: `O valor de ${formattedTotal} está pesando? Tente otimizar os ingredientes para um preço melhor!`,
    bodyContent: bodyContent
  });
};

export const getSeparationProgressEmailHTML = (props: DietStatusUpdateProps): string => {
  const { firstName } = props;
  const bodyContent = `
    <h2 style="font-size: 22px; color: #111; font-family: Arial, sans-serif; margin-top: 0;">Estamos a preparar a sua dieta!</h2>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Olá, ${firstName},</p>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Boas notícias! A nossa equipe já começou a separar os ingredientes frescos e de alta qualidade para a sua dieta personalizada. Estamos a garantir que tudo esteja perfeito para você.</p>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Você será notificado novamente assim que o seu pedido sair para entrega.</p>
    <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin: 30px 0;">
      <tr><td align="center">${createButtonHTML({ href: 'https://colormind.com.br/profile/orders', text: 'Ver Detalhes do Pedido' })}</td></tr>
    </table>
  `;
  return createEmailLayout({
    title: 'A sua dieta está a ser preparada!',
    preheaderText: 'A nossa equipe já está a separar os seus ingredientes.',
    bodyContent: bodyContent
  });
};

export const getDeliveryProgressEmailHTML = (props: DeliveryProgressProps): string => {
  const { firstName, address, driver } = props;
  let driverInfoHTML = '';
  const driverDetails: string[] = [];
  if (driver) {
    if (driver.name && driver.name !== 'Não identificado') {
      driverDetails.push(`<p style="margin: 0; font-size: 14px; color: #555555;"><strong>Motorista:</strong> ${capitalizeName(driver.name)}</p>`);
    }
    if (driver.vehicle && driver.vehicle !== 'Não identificado') {
      driverDetails.push(`<p style="margin: 8px 0 0; font-size: 14px; color: #555555;"><strong>Veículo:</strong> ${driver.vehicle}</p>`);
    }
    if (driver.licensePlate && driver.licensePlate !== 'Não identificada') {
      driverDetails.push(`<p style="margin: 8px 0 0; font-size: 14px; color: #555555;"><strong>Placa:</strong> ${driver.licensePlate}</p>`);
    }
    if (driver.eta && driver.eta !== 'Não identificado') {
      driverDetails.push(`<p style="margin: 8px 0 0; font-size: 14px; color: #555555;"><strong>Chega em:</strong> ${driver.eta}</p>`);
    }
  }
  if (driverDetails.length > 0) {
    driverInfoHTML = `
      <h3 style="font-size: 18px; color: #111; font-family: Arial, sans-serif; margin-top: 30px; margin-bottom: 10px;">Acompanhe sua entrega:</h3>
      <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin-bottom: 24px;">
        <tr><td style="background-color: #f8f8f8; padding: 16px; border-left: 3px solid #18181b; font-family: Arial, sans-serif;">${driverDetails.join('')}</td></tr>
      </table>
    `;
  }
  const bodyContent = `
    <h2 style="font-size: 22px; color: #111; font-family: Arial, sans-serif; margin-top: 0;">Sua dieta está a caminho!</h2>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Olá, ${firstName},</p>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Prepare-se! O seu pedido com todos os ingredientes para a sua dieta personalizada já saiu para entrega e chegará em breve ao seu endereço:</p>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555; border-left: 3px solid #18181b; padding-left: 15px; background-color: #f8f8f8; padding: 10px 15px;">
      <strong>${address.street}, ${address.number}</strong><br>
      ${address.neighborhood}, ${address.city} - ${address.state}
    </p>
    ${driverInfoHTML}
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Mal podemos esperar para que você comece!</p>
  `;
  return createEmailLayout({
    title: 'Sua dieta saiu para entrega!',
    preheaderText: 'Prepare-se, seu pedido chegará em breve.',
    bodyContent: bodyContent
  });
};

export const getDeliveredEmailHTML = (props: DietStatusUpdateProps): string => {
  const { firstName } = props;
  const bodyContent = `
    <h2 style="font-size: 22px; color: #111; font-family: Arial, sans-serif; margin-top: 0;">A sua dieta foi entregue!</h2>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Olá, ${firstName},</p>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">O seu pedido foi entregue com sucesso. Agora é só guardar os ingredientes e preparar-se para começar a sua jornada de otimização.</p>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Lembre-se de aceder ao seu plano para ver as porções e o modo de preparo de cada refeição.</p>
    <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin: 30px 0;">
      <tr><td align="center">${createButtonHTML({ href: 'https://colormind.com.br/profile/orders', text: 'Ver Minha Dieta' })}</td></tr>
    </table>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Bom apetite!</p>
  `;
  return createEmailLayout({
    title: 'O seu pedido colormind chegou!',
    preheaderText: 'Esperamos que goste e aproveite sua nova jornada!',
    bodyContent: bodyContent
  });
};

export const getReturnRequestReceivedEmailHTML = (props: ReturnRequestReceivedProps): string => {
  const { firstName, orderId } = props;
  const formattedId = formatOrderIdForDisplay(orderId);
  const bodyContent = `
    <h2 style="font-size: 22px; color: #111; font-family: Arial, sans-serif; margin-top: 0;">Recebemos sua solicitação de devolução</h2>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Olá, ${firstName},</p>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Confirmamos o recebimento da sua solicitação de devolução para o pedido <strong>${formattedId}</strong>.</p>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Nossa equipe de suporte irá analisar o seu caso com cuidado e entrará em contato em breve através deste e-mail com os próximos passos.</p>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555; margin-top: 24px;">Agradecemos pela sua paciência.</p>
  `;
  return createEmailLayout({
    title: `Sua solicitação de devolução está em análise`,
    preheaderText: 'Recebemos sua solicitação e entraremos em contato em breve.',
    bodyContent: bodyContent
  });
};

export const getPickerRegistrationReceivedHTML = (props: PickerRegistrationReceivedProps): string => {
  const { firstName } = props;
  const bodyContent = `
    <h2 style="font-size: 22px; color: #111; font-family: Arial, sans-serif; margin-top: 0;">🎉 Recebemos seu cadastro, ${firstName}!</h2>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Olá,</p>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Confirmamos o recebimento das suas informações e documentos para a vaga de Picker. Você deu o primeiro passo para se tornar uma parte essencial da nossa operação!</p>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Nossa equipe irá analisar tudo com cuidado e entraremos em contato por e-mail assim que o processo de aprovação for concluído.</p>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555; margin-top: 24px;">Agradecemos pelo seu interesse em se juntar à nossa equipe.</p>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Atenciosamente,<br>Equipe colormind</p>
  `;
  return createEmailLayout({
    title: `Seus dados de Picker estão em análise, ${firstName}!`,
    preheaderText: 'Recebemos suas informações e entraremos em contato em breve com os próximos passos.',
    bodyContent: bodyContent
  });
};

export const getPickerSupportConfirmationEmailHTML = (props: PickerSupportConfirmationProps): string => {
  const { firstName, subject } = props;
  const bodyContent = `
    <h2 style="font-size: 22px; color: #111; font-family: Arial, sans-serif; margin-top: 0;">Recebemos sua mensagem!</h2>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Olá, ${firstName},</p>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Confirmamos o recebimento da sua mensagem de suporte sobre o assunto: "<strong>${subject}</strong>".</p>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Nossa equipe irá analisar sua solicitação com cuidado e entrará em contato com você através do seu e-mail de cadastro o mais breve possível.</p>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555; margin-top: 24px;">Agradecemos pelo seu contato.</p>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Atenciosamente,<br>Equipe de Suporte Picker</p>
  `;
  return createEmailLayout({
    title: `Sua solicitação de suporte foi recebida`,
    preheaderText: `Recebemos sua mensagem sobre "${subject}" e responderemos em breve.`,
    bodyContent: bodyContent
  });
};

export const getSubstitutionEmailHTML = (props: SubstitutionEmailProps): string => {
  const { firstName, orderId, originalFoodName, substituteFoodName } = props;
  const formattedId = formatOrderIdForDisplay(orderId);
  const bodyContent = `
    <h2 style="font-size: 22px; color: #111; font-family: Arial, sans-serif; margin-top: 0;">Uma atualização no seu pedido ${formattedId}</h2>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Olá, ${firstName},</p>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Durante a separação dos seus alimentos, nosso picker notou que o item <strong>"${originalFoodName}"</strong> não estava disponível com a qualidade que exigimos.</p>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Para garantir que sua dieta não fosse prejudicada, ele(a) o substituiu por uma alternativa de alta qualidade:</p>
    <div style="background-color: #f8f8f8; padding: 16px; border-radius: 8px; text-align: center; margin: 24px 0; border-left: 3px solid #18181b;">
      <p style="font-family: Arial, sans-serif; font-size: 18px; color: #111; font-weight: bold; margin: 0;">${substituteFoodName}</p>
    </div>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Fique tranquilo(a), a troca foi pensada para manter o balanço nutricional e o valor do seu plano. Seu pedido continua em preparação e logo estará a caminho.</p>
    <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin: 30px 0;">
      <tr><td align="center">${createButtonHTML({ href: `https://colormind.com.br/profile?section=diets`, text: 'Acompanhar Pedido' })}</td></tr>
    </table>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Atenciosamente,<br>Equipe colormind</p>
  `;
  return createEmailLayout({
    title: `Item substituído no seu pedido ${formattedId}`,
    preheaderText: `O item ${originalFoodName} foi substituído por ${substituteFoodName}.`,
    bodyContent: bodyContent
  });
};

export const getNewSupportTicketEmailHTML = (props: NewSupportTicketProps): string => {
  const { userName, userEmail, orderId, ticketSubject, ticketMessage, ticketLink } = props;
  const formattedId = formatOrderIdForDisplay(orderId);
  const bodyContent = `
    <h2 style="font-size: 22px; color: #111; font-family: Arial, sans-serif; margin-top: 0;">Novo Ticket de Suporte Aberto</h2>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Um novo chamado de suporte foi criado na plataforma.</p>
    <div style="background-color: #f8f8f8; padding: 16px; border-radius: 8px; margin: 24px 0; font-family: Arial, sans-serif;">
      <p style="margin: 0 0 10px 0;"><strong>Cliente:</strong> ${userName} (${userEmail})</p>
      <p style="margin: 0 0 10px 0;"><strong>Pedido:</strong> ${formattedId}</p>
      <p style="margin: 0 0 10px 0;"><strong>Assunto:</strong> ${ticketSubject}</p>
      <hr style="border: none; border-top: 1px solid #ddd; margin: 15px 0;">
      <p style="margin: 0;"><strong>Mensagem:</strong></p>
      <p style="margin: 5px 0 0; font-style: italic;">"${ticketMessage}"</p>
    </div>
    <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin: 30px 0;">
      <tr><td align="center">${createButtonHTML({ href: ticketLink, text: 'Ver e Responder ao Ticket' })}</td></tr>
    </table>
  `;
  return createEmailLayout({
    title: `Novo Ticket de Suporte - Pedido ${formattedId}`,
    preheaderText: `Cliente: ${userName} | Assunto: ${ticketSubject}`,
    bodyContent: bodyContent
  });
};

export const getSupportReplyNotificationEmailHTML = (props: SupportReplyNotificationProps): string => {
  const { firstName } = props;
  const bodyContent = `
    <h2 style="font-size: 22px; color: #111; font-family: Arial, sans-serif; margin-top: 0;">Você tem uma nova mensagem do suporte!</h2>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Olá, ${firstName},</p>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Nossa equipe de suporte respondeu à sua dúvida no chat. Para visualizar a resposta e continuar a conversa, clique no botão abaixo e acesse sua conta.</p>
    <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin: 30px 0;">
      <tr><td align="center">${createButtonHTML({ href: 'https://colormind.com.br/profile?section=diets', text: 'Ver Mensagem no Chat' })}</td></tr>
    </table>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Se preferir, acesse nosso site e abra o chat de suporte na sua área de perfil.</p>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Atenciosamente,<br>Equipe colormind</p>
  `;
  return createEmailLayout({
    title: 'Nova Resposta do Suporte - colormind',
    preheaderText: 'Nossa equipe respondeu sua mensagem no chat. Veja agora.',
    bodyContent: bodyContent
  });
};

export const getNewSupportMessageEmailHTML = (props: NewSupportMessageProps): string => {
  const { userFullName, dietId, adminPanelLink } = props;
  const formattedId = formatOrderIdForDisplay(dietId);
  const bodyContent = `
    <h2 style="font-size: 22px; color: #111; font-family: Arial, sans-serif; margin-top: 0;">Nova Mensagem de Suporte Não Lida</h2>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Atenção, equipa!</p>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Há uma nova mensagem do utilizador <strong>${userFullName}</strong> que não foi visualizada.</p>
    <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin: 24px 0;">
      <tr>
        <td style="background-color: #f8f8f8; padding: 16px; border-left: 3px solid #f59e0b; font-family: Arial, sans-serif;">
          <p style="margin: 0; font-size: 14px; color: #555555;">Referência do Pedido: <strong style="color: #111;">${formattedId}</strong></p>
        </td>
      </tr>
    </table>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Por favor, aceda ao painel de administração para responder o mais breve possível.</p>
    <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin: 30px 0;">
      <tr><td align="center">${createButtonHTML({ href: adminPanelLink, text: 'Ir para o Painel de Suporte' })}</td></tr>
    </table>
  `;
  return createEmailLayout({
    title: `Pendente: Nova mensagem de ${userFullName}`,
    preheaderText: `O pedido ${formattedId} precisa de atenção.`,
    bodyContent: bodyContent
  });
};

// Adicione esta nova função de template ao final do arquivo
export const getSupportInitiatedContactEmailHTML = (props: SupportInitiatedContactProps): string => {
  const { firstName, orderId } = props;
  const formattedId = formatOrderIdForDisplay(orderId);
  const bodyContent = `
    <h2 style="font-size: 22px; color: #111; font-family: Arial, sans-serif; margin-top: 0;">Temos uma mensagem para você!</h2>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Olá, ${firstName},</p>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Nossa equipe de suporte iniciou um contato com você referente ao seu pedido <strong>${formattedId}</strong>. Para visualizar a mensagem e nos responder, por favor, acesse o chat no seu perfil.</p>
    <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin: 30px 0;">
      <tr><td align="center">${createButtonHTML({ href: 'https://colormind.com.br/orders', text: 'Ir para os Pedidos' })}</td></tr>
    </table>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Aguardamos o seu retorno.</p>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Atenciosamente,<br>Equipe colormind</p>
  `;
  return createEmailLayout({
    title: `Nova Mensagem do Suporte - Pedido ${formattedId}`,
    preheaderText: `Nossa equipe entrou em contato sobre seu pedido. Veja agora.`,
    bodyContent: bodyContent
  });
};

export const getRefundProcessedEmailHTML = (props: RefundEmailParams): string => {
  const { firstName, orderId, refundAmount } = props;
  const formattedAmount = refundAmount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const formattedId = formatOrderIdForDisplay(orderId);
  const bodyContent = `
    <h2 style="font-size: 22px; color: #111; font-family: Arial, sans-serif; margin-top: 0;">Pedido Cancelado e Estorno Realizado</h2>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Olá, ${firstName},</p>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Confirmamos que a solicitação de cancelamento para o pedido <strong>${formattedId}</strong> foi processada com sucesso.</p>
    <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin: 24px 0;">
      <tr>
        <td style="background-color: #f8f8f8; padding: 16px; border-left: 3px solid #18181b; font-family: Arial, sans-serif;">
          <p style="margin: 0; font-size: 14px; color: #555555;">Valor Estornado: <strong style="color: #111;">${formattedAmount}</strong></p>
        </td>
      </tr>
    </table>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">O valor será creditado na mesma conta de origem do pagamento PIX. O prazo para a visualização em seu extrato pode variar de acordo com o seu banco.</p>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Se tiver qualquer dúvida, não hesite em nos contatar.</p>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Atenciosamente,<br>Equipe colormind</p>
  `;
  return createEmailLayout({
    title: `Estorno processado para o pedido ${formattedId}`,
    preheaderText: `Seu estorno no valor de ${formattedAmount} foi processado com sucesso.`,
    bodyContent: bodyContent
  });
};

export const getAutoCancelledRefundEmailHTML = (props: AutoCancelEmailParams): string => {
  const { firstName, orderId, refundAmount } = props;
  const formattedAmount = refundAmount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const formattedId = formatOrderIdForDisplay(orderId);
  const bodyContent = `

    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Olá, ${firstName},</p>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Pedimos sinceras desculpas. Devido a uma demanda inesperada em nossa operação, não conseguimos iniciar a preparação do seu pedido <strong>${formattedId}</strong> dentro do nosso prazo padrão.</p>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Para não te prejudicar, cancelamos o pedido e já processamos o estorno integral do valor pago.</p>
    <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin: 24px 0;">
      <tr>
        <td style="background-color: #f8f8f8; padding: 16px; border-left: 3px solid #dc3545; font-family: Arial, sans-serif;">
          <p style="margin: 0; font-size: 14px; color: #555555;">Valor Estornado: <strong style="color: #111;">${formattedAmount}</strong></p>
        </td>
      </tr>
    </table>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">O valor será creditado na mesma conta de origem do pagamento PIX. O prazo para a visualização em seu extrato pode variar de acordo com o seu banco.</p>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Lamentamos profundamente o inconveniente e esperamos poder te atender melhor em uma próxima oportunidade.</p>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Atenciosamente,<br>Equipe colormind</p>
  `;
  return createEmailLayout({
    title: `Seu pedido ${formattedId} foi cancelado`,
    preheaderText: `Sentimos muito! Seu pedido foi cancelado e o estorno de ${formattedAmount} foi processado.`,
    bodyContent: bodyContent
  });
  
};

export const getNewPickerForApprovalEmailHTML = (details: {
  pickerName: string;
  pickerEmail: string;
  adminPanelLink: string;
}) => {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 20px auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px; }
        .header { font-size: 24px; font-weight: bold; color: #1e3a8a; text-align: center; }
        .content { margin-top: 20px; }
        .info-block { background-color: #f9fafb; border: 1px solid #e5e7eb; padding: 15px; border-radius: 8px; }
        .info-block p { margin: 5px 0; }
        .cta-button { display: inline-block; background-color: #2563eb; color: #ffffff; padding: 12px 25px; margin-top: 20px; text-decoration: none; border-radius: 5px; font-weight: bold; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">Novo Picker para Aprovação</div>
        <div class="content">
          <p>Olá,</p>
          <p>Um novo candidato a picker acaba de completar o cadastro e aguarda sua análise e aprovação.</p>
          <div class="info-block">
            <p><strong>Nome:</strong> ${details.pickerName}</p>
            <p><strong>E-mail:</strong> ${details.pickerEmail}</p>
          </div>
          <p style="text-align: center;">
            <a href="${details.adminPanelLink}" class="cta-button">Analisar Cadastro</a>
          </p>
          <p>Por favor, acesse o painel de administração para revisar os documentos e ativar a conta do picker.</p>
        </div>
      </div>
    </body>
    </html>
  `;
};

export const getNewProblemReportAlertEmailHTML = (props: NewProblemReportAlertProps): string => {
  const { dietId, reportId, pickerName, category, description, adminPanelLink } = props;

  const bodyContent = `
    <h2 style="font-size: 22px; color: #dc3545; font-family: Arial, sans-serif; margin-top: 0;">Alerta: Novo Problema Reportado</h2>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Um picker reportou um problema que requer atenção imediata.</p>
    
    <div style="background-color: #f8f8f8; padding: 16px; border-radius: 8px; margin: 24px 0; font-family: Arial, sans-serif; border-left: 3px solid #dc3545;">
      <p style="margin: 0 0 10px 0;"><strong>Picker:</strong> ${pickerName}</p>
      <p style="margin: 0 0 10px 0;"><strong>Pedido N°:</strong> ${dietId}</p>
      <p style="margin: 0 0 10px 0;"><strong>Reporte ID:</strong> ${reportId}</p>
      <p style="margin: 0 0 10px 0;"><strong>Categoria:</strong> ${category}</p>
      <hr style="border: none; border-top: 1px solid #ddd; margin: 15px 0;">
      <p style="margin: 0;"><strong>Descrição do Problema:</strong></p>
      <p style="margin: 5px 0 0; font-style: italic;">"${description}"</p>
    </div>

    <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin: 30px 0;">
      <tr>
        <td align="center">
          ${createButtonHTML({ href: adminPanelLink, text: 'Ver Detalhes e Agir' })}
        </td>
      </tr>
    </table>
  `;

  return createEmailLayout({
    title: `[AÇÃO NECESSÁRIA] Reporte de Problema - Pedido ${dietId}`,
    preheaderText: `Picker ${pickerName} reportou: ${category}`,
    bodyContent: bodyContent
  });
};


/**
 * E-MAIL DE PRIMEIRO AVISO (40 MINUTOS) PARA O PICKER
 */
export const getSeparationDelayedWarningEmailHTML = (props: SeparationDelayedWarningProps): string => {
  const { pickerFirstName, orderIdShort, customerName } = props;

  const bodyContent = `
    <h2 style="font-size: 22px; color: #f59e0b; font-family: Arial, sans-serif; margin-top: 0;">Atenção: Atraso na Separação</h2>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Olá, ${pickerFirstName},</p>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Notamos que a separação do pedido <strong>${orderIdShort}</strong> para o cliente <strong>${customerName}</strong> está a levar mais tempo que o esperado (mais de 40 minutos).</p>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Por favor, agilize a finalização para garantir a pontualidade da entrega. Se você estiver enfrentando algum problema que o impeça de continuar, é fundamental que você o reporte imediatamente através do aplicativo.</p>
    <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin: 30px 0;">
      <tr>
        <td align="center">
          ${createButtonHTML({ href: 'https://picker.colormind.com.br/', text: 'Ver Pedido no App' })}
        </td>
      </tr>
    </table>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Contamos com a sua colaboração.</p>
  `;

  return createEmailLayout({
    title: `Atenção: Atraso na Separação do Pedido ${orderIdShort}`,
    preheaderText: `O pedido para ${customerName} está em separação há mais de 40 minutos.`,
    bodyContent: bodyContent
  });
};

/**
 * E-MAIL DE AVISO FINAL (1 HORA) PARA O PICKER
 */
export const getSeparationFinalWarningEmailHTML = (props: SeparationFinalWarningProps): string => {
  const { pickerFirstName, orderIdShort, customerName } = props;

  const bodyContent = `
    <h2 style="font-size: 22px; color: #dc3545; font-family: Arial, sans-serif; margin-top: 0;">AVISO FINAL: Pedido em Risco de Cancelamento</h2>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Olá, ${pickerFirstName},</p>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">A separação do pedido <strong>${orderIdShort}</strong> para o cliente <strong>${customerName}</strong> ultrapassou o limite de 1 hora. Este é um aviso final.</p>
    <p style="font-family: Arial, sans-serif; font-size: 16px; font-weight: bold; color: #dc3545;">Se a separação não for concluída e o pedido não avançar para a próxima etapa nos próximos 15 minutos, ele será AUTOMATICAMENTE CANCELADO e reatribuído a outro picker.</p>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Se houver um problema crítico, reporte-o IMEDIATAMENTE no aplicativo para evitar o cancelamento.</p>
    <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin: 30px 0;">
      <tr>
        <td align="center">
          ${createButtonHTML({ href: 'https://picker.colormind.com.br/', text: 'Agir Agora no Pedido' })}
        </td>
      </tr>
    </table>
  `;

  return createEmailLayout({
    title: `AVISO URGENTE: Pedido ${orderIdShort} será cancelado`,
    preheaderText: `Ação necessária: O pedido para ${customerName} será cancelado em 15 minutos.`,
    bodyContent: bodyContent
  });
};

export const getPickerProblemApologyEmailHTML = (props: PickerProblemApologyEmailProps): string => {
  const { firstName, orderId } = props;
  const formattedId = formatOrderIdForDisplay(orderId);

  const bodyContent = `
    <h2 style="font-size: 22px; color: #111; font-family: Arial, sans-serif; margin-top: 0;">Uma atualização sobre seu pedido ${formattedId}</h2>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Olá, ${firstName},</p>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Lamentamos profundamente. Durante a separação dos ingredientes frescos para a sua dieta, nosso especialista encontrou um imprevisto que nos impediu de prosseguir com a montagem do seu pedido dentro dos nossos padrões de qualidade.</p>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Por este motivo, o seu pedido <strong>${formattedId}</strong> teve de ser cancelado. Queremos assegurar que esta não é a experiência que desejamos oferecer.</p>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">O estorno do valor pago já foi processado e você receberá uma confirmação separada sobre isso em seu e-mail.</p>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Esperamos sinceramente ter uma nova oportunidade de te atender e mostrar a qualidade que dedicamos em nosso serviço.</p>
    
    <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin: 30px 0;">
      <tr><td align="center">${createButtonHTML({ href: 'https://colormind.com.br/', text: 'Montar uma Nova Dieta' })}</td></tr>
    </table>
  `;

  return createEmailLayout({
    title: `Um imprevisto com o seu pedido ${formattedId}`,
    preheaderText: `Sentimos muito! Ocorreu um problema na separação e seu pedido precisou ser cancelado.`,
    bodyContent: bodyContent
  });
};


/**
 * E-MAIL DE ALERTA PARA O ADMIN SOBRE UM PEDIDO CANCELADO E ESTORNADO
 */
export const getAdminRefundAlertEmailHTML = (props: AdminRefundAlertProps): string => {
  const { orderIdFormatted, customerName, reason, refundAmount, adminPanelLink } = props;

  const formattedAmount = refundAmount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  const bodyContent = `
    <h2 style="font-size: 22px; color: #111; font-family: Arial, sans-serif; margin-top: 0;">Alerta de Operação: Pedido Estornado</h2>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Um pedido foi cancelado e o estorno foi processado com sucesso no sistema.</p>
    
    <div style="background-color: #f8f8f8; padding: 16px; border-radius: 8px; margin: 24px 0; font-family: Arial, sans-serif; border-left: 3px solid #18181b;">
      <p style="margin: 0 0 10px 0;"><strong>Pedido:</strong> ${orderIdFormatted}</p>
      <p style="margin: 0 0 10px 0;"><strong>Cliente:</strong> ${customerName}</p>
      <p style="margin: 0 0 10px 0;"><strong>Valor Estornado:</strong> <strong style="color: #111;">${formattedAmount}</strong></p>
      <hr style="border: none; border-top: 1px solid #ddd; margin: 15px 0;">
      <p style="margin: 0;"><strong>Motivo do Cancelamento:</strong></p>
      <p style="margin: 5px 0 0; font-style: italic;">"${reason}"</p>
    </div>

    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Nenhuma ação adicional é necessária. Este é apenas um registro para o seu controle.</p>
    <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin: 30px 0;">
      <tr>
        <td align="center">
          ${createButtonHTML({ href: adminPanelLink, text: 'Ver Pedido no Painel' })}
        </td>
      </tr>
    </table>
  `;

  return createEmailLayout({
    title: `Estorno Concluído - Pedido ${orderIdFormatted}`,
    preheaderText: `O estorno de ${formattedAmount} para ${customerName} foi processado.`,
    bodyContent: bodyContent
  });
};

export const getSupportTicketAlertEmailHTML = (details: {
  ticketId: string;
  pickerName: string;
  pickerEmail: string;
  subject: string;
  message: string;
  adminPanelLink: string;
}) => {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <style> /* ... (estilos do e-mail, similares aos outros) ... */ </style>
    </head>
    <body>
      <div class="container">
        <div class="header">Novo Ticket de Suporte</div>
        <div class="content">
          <p>Um picker enviou uma nova mensagem de suporte.</p>
          <div class="info-block">
            <p><strong>De:</strong> ${details.pickerName} (${details.pickerEmail})</p>
            <p><strong>Assunto:</strong> ${details.subject}</p>
            <p><strong>Mensagem:</strong></p>
            <p style="white-space: pre-wrap;">${details.message}</p>
          </div>
          <p style="text-align: center;">
            <a href="${details.adminPanelLink}" class="cta-button">Ver Ticket no Painel</a>
          </p>
        </div>
      </div>
    </body>
    </html>
  `;
};


/**
 * E-MAIL PARA INFORMAR O CLIENTE SOBRE A ENTREGA AGENDADA
 */
export const getDelayedDeliveryEmailHTML = (props: DelayedDeliveryEmailProps): string => {
  const { firstName, deliveryDay } = props;

  const bodyContent = `
    <h2 style="font-size: 22px; color: #111; font-family: Arial, sans-serif; margin-top: 0;">Seu pedido foi agendado! 🗓️</h2>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Olá, ${firstName},</p>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Seu pagamento foi confirmado com sucesso! Como o pedido foi realizado fora do nosso horário de separação, ele foi agendado para o próximo dia disponível.</p>
    
    <div style="background-color: #f8f8f8; padding: 16px; border-radius: 8px; text-align: center; margin: 24px 0; border-left: 3px solid #18181b;">
      <p style="font-family: Arial, sans-serif; font-size: 14px; color: #555555; margin: 0;">Sua entrega chegará:</p>
      <p style="font-family: Arial, sans-serif; font-size: 18px; color: #111; font-weight: bold; margin: 5px 0 0 0;">${capitalizeName(deliveryDay)}</p>
    </div>

    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Fique tranquilo(a), você receberá uma nova notificação assim que nossa equipe começar a separar seus ingredientes no dia da entrega.</p>
    <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin: 30px 0;">
      <tr>
        <td align="center">
          ${createButtonHTML({ href: 'https://colormind.com.br/orders', text: 'Acompanhar Pedido' })}
        </td>
      </tr>
    </table>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Agradecemos pela sua compreensão!</p>
  `;

  return createEmailLayout({
    title: `Seu pedido foi agendado para ${deliveryDay}`,
    preheaderText: `Sua entrega foi programada. Saiba mais detalhes aqui.`,
    bodyContent: bodyContent
  });
};


/**
 * E-MAIL DE LEMBRETE ENVIADO NA MANHÃ DO DIA DA ENTREGA AGENDADA
 */
export const getScheduledDeliveryReminderEmailHTML = (props: ScheduledDeliveryReminderProps): string => {
  const { firstName } = props;

  const bodyContent = `
    <h2 style="font-size: 22px; color: #111; font-family: Arial, sans-serif; margin-top: 0;">Lembrete: Sua dieta será preparada hoje!</h2>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Olá, ${firstName},</p>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Este é um lembrete amigável de que, conforme o nosso agendamento, a preparação dos ingredientes frescos para a sua dieta começará hoje.</p>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Você receberá novas notificações assim que um de nossos especialistas for designado e iniciar a separação. Não é necessária nenhuma ação da sua parte.</p>
    <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin: 30px 0;">
      <tr>
        <td align="center">
          ${createButtonHTML({ href: 'https://colormind.com.br/orders', text: 'Acompanhar Pedido' })}
        </td>
      </tr>
    </table>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Agradecemos pela sua paciência!</p>
  `;

  return createEmailLayout({
    title: `Lembrete de Entrega Agendada`,
    preheaderText: `A preparação da sua dieta começa hoje. Acompanhe as próximas etapas.`,
    bodyContent: bodyContent
  });
};


export const getAccountDeletionConfirmationEmailHTML = (props: AccountDeletionProps): string => {
  const { firstName } = props;
  const bodyContent = `
    <h2 style="font-size: 22px; color: #111; font-family: Arial, sans-serif; margin-top: 0;">Sua conta colormind foi desativada</h2>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Olá, ${firstName},</p>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Confirmamos que sua solicitação para excluir sua conta foi processada. Sua conta e dados pessoais foram desativados e não estão mais acessíveis publicamente.</p>
    <div style="background-color: #f8f8f8; padding: 16px; border-radius: 8px; margin: 24px 0; border-left: 3px solid #f59e0b;">
      <h3 style="margin-top:0; font-family: Arial, sans-serif; color: #111;">Período de Reativação de 30 Dias</h3>
      <p style="margin: 0; font-family: Arial, sans-serif; font-size: 14px; color: #555555;">Se você mudar de ideia, pode reativar sua conta e recuperar seus dados simplesmente fazendo login em nosso site nos próximos 30 dias. Após este período, seus dados serão anonimizados permanentemente.</p>
    </div>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Lamentamos ver você partir e esperamos que reconsidere se juntar a nós no futuro.</p>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Atenciosamente,<br>Equipe colormind</p>
  `;
  return createEmailLayout({
    title: `Sua conta foi desativada`,
    preheaderText: `Você pode reativar sua conta fazendo login nos próximos 30 dias.`,
    bodyContent: bodyContent
  });
};

export const getAccountReactivatedEmailHTML = (props: AccountReactivatedProps): string => {
  const { firstName } = props;
  const bodyContent = `
    <h2 style="font-size: 22px; color: #111; font-family: Arial, sans-serif; margin-top: 0;">Bem-vindo(a) de volta, ${firstName}!</h2>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Olá,</p>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Sua conta na <strong>colormind</strong> foi reativada com sucesso. Todos os seus dados e histórico de pedidos foram restaurados.</p>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Estamos felizes em tê-lo(a) de volta!</p>
    <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin: 30px 0;">
      <tr><td align="center">${createButtonHTML({ href: 'https://colormind.com.br/profile', text: 'Acessar Minha Conta' })}</td></tr>
    </table>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Atenciosamente,<br>Equipe colormind</p>
  `;
  return createEmailLayout({
    title: `Sua conta foi reativada!`,
    preheaderText: `Seus dados foram restaurados. Bem-vindo(a) de volta!`,
    bodyContent: bodyContent
  });
};


export const getQueueAvailableEmailHTML = (props: QueueAvailableProps): string => {
  const { firstName } = props;
  const bodyContent = `
    <h2 style="font-size: 22px; color: #111; font-family: Arial, sans-serif; margin-top: 0;">Uma ótima notícia, ${firstName}!</h2>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Lembra que você tentou criar uma dieta e nossa fila de pedidos estava cheia? Boas notícias: uma vaga acabou de abrir para você!</p>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Acesse nosso site agora para garantir seu lugar e montar sua dieta personalizada.</p>
    <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin: 30px 0;">
      <tr><td align="center">${createButtonHTML({ href: 'https://colormind.com.br/', text: 'Montar Minha Dieta Agora' })}</td></tr>
    </table>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Estamos ansiosos para te atender!</p>
  `;
  return createEmailLayout({
    title: `Sua vaga na fila está disponível!`,
    preheaderText: `Uma vaga abriu na nossa fila de pedidos. Crie sua dieta agora!`,
    bodyContent: bodyContent
  });
};

export const getRegionAvailableEmailHTML = (props: RegionAvailableProps): string => {
  const { firstName, cityName } = props;
  const bodyContent = `
    <h2 style="font-size: 22px; color: #111; font-family: Arial, sans-serif; margin-top: 0;">Temos uma novidade para você!</h2>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Olá, ${firstName},</p>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Temos uma excelente notícia! Você havia solicitado uma dieta para a cidade de <strong>${cityName}</strong>, e agora estamos felizes em anunciar que expandimos nossa área de entrega e já estamos atendendo a sua região!</p>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Acesse nosso site para ser um dos primeiros a receber uma dieta personalizada no seu endereço.</p>
    <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin: 30px 0;">
      <tr><td align="center">${createButtonHTML({ href: 'https://colormind.com.br/', text: 'Montar Minha Dieta' })}</td></tr>
    </table>
  `;
  return createEmailLayout({
    title: `Boas notícias! Já estamos entregando em ${cityName}!`,
    preheaderText: `Você pediu e nós atendemos. Sua região agora faz parte da nossa área de cobertura.`,
    bodyContent: bodyContent
  });
};

export const getNextDayAvailableEmailHTML = (props: NextDayAvailableProps): string => {
  const { firstName } = props;
  const bodyContent = `
    <h2 style="font-size: 22px; color: #111; font-family: Arial, sans-serif; margin-top: 0;">Já estamos prontos para você!</h2>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Olá, ${firstName},</p>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Você tentou criar um pedido fora do nosso horário de atendimento. Gostaríamos de avisar que já estamos operando e prontos para montar a sua dieta personalizada hoje mesmo.</p>
    <p style="font-family: Arial, sans-serif; font-size: 16px; color: #555555;">Clique no botão abaixo para começar.</p>
    <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin: 30px 0;">
      <tr><td align="center">${createButtonHTML({ href: 'https://colormind.com.br/', text: 'Montar Minha Dieta' })}</td></tr>
    </table>
  `;
  return createEmailLayout({
    title: 'Estamos prontos para montar sua dieta!',
    preheaderText: 'Nosso horário de atendimento já começou. Faça seu pedido agora!',
    bodyContent: bodyContent
  });
};

export const getRegistrationStartAdminAlertEmailHTML = (props: { userEmail: string, userName?: string }): string => {
  const { userEmail, userName } = props;
  const userNameHtml = userName ? `<p style="font-size: 16px;"><strong>Nome:</strong> ${userName}</p>` : '';

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { width: 90%; max-width: 600px; margin: 20px auto; padding: 20px; border: 1px solid #ddd; border-radius: 8px; }
        .header { font-size: 24px; color: #444; margin-bottom: 20px; text-align: center; }
        .content p { margin: 10px 0; }
        .footer { margin-top: 20px; font-size: 12px; color: #777; text-align: center; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">🚀 Início de Novo Cadastro</div>
        <div class="content">
          <p>Olá!</p>
          <p>Um novo usuário acabou de iniciar o processo de cadastro na <strong>colormind</strong>.</p>
          <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
          <p style="font-size: 16px;"><strong>E-mail:</strong> ${userEmail}</p>
          ${userNameHtml}
        </div>
        <div class="footer">
          <p>Este é um e-mail automático. Nenhuma ação é necessária neste momento.</p>
        </div>
      </div>
    </body>
    </html>
  `;
};

use anchor_lang::prelude::*;
use anchor_lang::solana_program::{program::invoke_signed, system_instruction};
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

declare_id!("G6RB5XQwcnXXp34vDot3ERcbGS8RcXUtacMhgXAM8P7n");

const VAULT_CONFIG_SEED: &[u8] = b"vault-config";
const ORDER_SEED: &[u8] = b"order";
const ESCROW_AUTHORITY_SEED: &[u8] = b"escrow-authority";
const SOL_VAULT_SEED: &[u8] = b"sol-vault";

const PYTH_PRICE_ACCOUNT_SIZE: usize = 3312;
const PYTH_MAGIC: u32 = 0xa1b2c3d4;
const PYTH_VERSION: u32 = 2;
const PYTH_PRICE_TYPE: u32 = 3;

const STATUS_OPEN: u8 = 1;
const STATUS_EXECUTED: u8 = 2;
const STATUS_CANCELLED: u8 = 3;
const STATUS_EXPIRED: u8 = 4;
const STATUS_RECLAIMED: u8 = 5;

const MIN_SOL_VAULT_BUFFER_LAMPORTS: u64 = 5_000_000;

#[program]
pub mod conditional_escrow_buy {
    use super::*;

    pub fn initialize_vault_config(
        ctx: Context<InitializeVaultConfig>,
        params: InitializeVaultConfigParams,
    ) -> Result<()> {
        require!(params.max_confidence_bps <= 10_000, ErrorCode::InvalidConfidenceBpsRange);
        require!(params.usdc_decimals <= 18, ErrorCode::InvalidUsdcDecimals);
        require!(params.max_oracle_age_seconds >= 1, ErrorCode::InvalidOracleAge);

        let vault_config = &mut ctx.accounts.vault_config;
        vault_config.admin = ctx.accounts.admin.key();
        vault_config.treasury_usdc_ata = params.treasury_usdc_ata;
        vault_config.usdc_test_mint = params.usdc_test_mint;
        vault_config.oracle_feed = params.oracle_feed;
        vault_config.usdc_decimals = params.usdc_decimals;
        vault_config.sol_vault = params.sol_vault;
        vault_config.max_oracle_age_seconds = params.max_oracle_age_seconds;
        vault_config.max_confidence_bps = params.max_confidence_bps;
        vault_config.paused = params.paused;
        vault_config.vault_bump = params.vault_bump;
        vault_config.vault_bump = vault_config.vault_bump;
        vault_config.bump = ctx.bumps.vault_config;
        Ok(())
    }

    pub fn fund_sol_vault(ctx: Context<FundSolVault>, params: FundSolVaultParams) -> Result<()> {
        require!(!ctx.accounts.vault_config.paused, ErrorCode::VaultPaused);
        require!(
            ctx.accounts.admin.key() == ctx.accounts.vault_config.admin,
            ErrorCode::Unauthorized
        );
        require!(params.amount > 0, ErrorCode::InvalidFundAmount);
        require!(
            ctx.accounts.admin.to_account_info().lamports() > params.amount,
            ErrorCode::InsufficientAdminSol
        );

        let transfer_ix = system_instruction::transfer(
            &ctx.accounts.admin.key(),
            &ctx.accounts.sol_vault.key(),
            params.amount,
        );

        invoke_signed(
            &transfer_ix,
            &[
                ctx.accounts.admin.to_account_info(),
                ctx.accounts.sol_vault.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            &[],
        )?;

        Ok(())
    }

    pub fn create_order_and_deposit(
        ctx: Context<CreateOrderAndDeposit>,
        params: CreateOrderAndDepositParams,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;

        require!(!ctx.accounts.vault_config.paused, ErrorCode::VaultPaused);
        require!(params.client_order_id > 0, ErrorCode::InvalidClientOrderId);
        require!(params.desired_sol_lamports > 0, ErrorCode::InvalidDesiredSolAmount);
        require!(params.max_usdc_in > 0, ErrorCode::InvalidMaxUsdcIn);
        require!(params.target_price_usd_e8 > 0, ErrorCode::InvalidTargetPrice);
        require!(params.deposit_amount > 0, ErrorCode::InvalidDepositAmount);
        require!(
            params.deposit_amount <= params.max_usdc_in,
            ErrorCode::DepositExceedsMaxUsdc
        );
        require!(params.expires_at > now, ErrorCode::OrderExpired);
        require!(params.recipient != Pubkey::default(), ErrorCode::InvalidRecipient);
        require!(params.max_oracle_age_seconds > 0, ErrorCode::InvalidOracleAge);
        require!(params.max_confidence_bps > 0, ErrorCode::InvalidConfidenceBps);

        require_keys_eq!(
            ctx.accounts.oracle_price_feed.key(),
            ctx.accounts.vault_config.oracle_feed,
            ErrorCode::OracleFeedMismatch
        );
        require_keys_eq!(
            ctx.accounts.vault_config.usdc_test_mint,
            ctx.accounts.user_usdc_token_account.mint,
            ErrorCode::InvalidMint
        );
        require_keys_eq!(
            ctx.accounts.escrow_token_account.mint,
            ctx.accounts.vault_config.usdc_test_mint,
            ErrorCode::InvalidMint
        );
        require_keys_eq!(
            ctx.accounts.treasury_usdc_ata.mint,
            ctx.accounts.vault_config.usdc_test_mint,
            ErrorCode::InvalidMint
        );

        let sol_vault = Pubkey::find_program_address(
            &[SOL_VAULT_SEED, ctx.accounts.vault_config.key().as_ref()],
            ctx.program_id,
        )
        .0;
        require_keys_eq!(sol_vault, ctx.accounts.vault_config.sol_vault, ErrorCode::VaultMismatchConfig);

        let order = &mut ctx.accounts.order;
        order.user = ctx.accounts.user.key();
        order.recipient = params.recipient;
        order.client_order_id = params.client_order_id;
        order.usdc_test_mint = ctx.accounts.vault_config.usdc_test_mint;
        order.escrow_token_account = ctx.accounts.escrow_token_account.key();
        order.treasury_usdc_ata = ctx.accounts.treasury_usdc_ata.key();
        order.sol_vault_pda = ctx.accounts.vault_config.sol_vault;
        order.oracle_feed = ctx.accounts.oracle_price_feed.key();
        order.desired_sol_lamports = params.desired_sol_lamports;
        order.max_usdc_in = params.max_usdc_in;
        order.target_price_usd_e8 = params.target_price_usd_e8;
        order.max_oracle_age_seconds = params.max_oracle_age_seconds;
        order.max_confidence_bps = params.max_confidence_bps;
        order.escrowed_usdc_amount = params.deposit_amount;
        order.executed_usdc_amount = 0;
        order.executed_sol_lamports = 0;
        order.created_at = now;
        order.expires_at = params.expires_at;
        order.escrow_authority_bump = ctx.bumps.escrow_authority;
        order.bump = ctx.bumps.order;
        order.status = STATUS_OPEN;

        let transfer_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.user_usdc_token_account.to_account_info(),
                to: ctx.accounts.escrow_token_account.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
                mint: ctx.accounts.usdc_mint.to_account_info(),
            },
        );

        token::transfer_checked(
            transfer_ctx,
            params.deposit_amount,
            ctx.accounts.vault_config.usdc_decimals,
        )?;

        Ok(())
    }

    pub fn execute_order(ctx: Context<ExecuteOrder>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let vault_config = &ctx.accounts.vault_config;
        let order = &mut ctx.accounts.order;

        require!(!vault_config.paused, ErrorCode::VaultPaused);
        require_eq!(order.status, STATUS_OPEN, ErrorCode::OrderNotOpen);
        require!(now <= order.expires_at, ErrorCode::OrderExpired);
        require_keys_eq!(
            order.oracle_feed,
            ctx.accounts.oracle_price_feed.key(),
            ErrorCode::OracleFeedMismatch
        );
        require_keys_eq!(
            order.escrow_token_account,
            ctx.accounts.escrow_token_account.key(),
            ErrorCode::InvalidEscrowAccount
        );
        require_keys_eq!(
            order.treasury_usdc_ata,
            ctx.accounts.treasury_usdc_ata.key(),
            ErrorCode::TreasuryAtaMismatch
        );
        require_keys_eq!(
            vault_config.usdc_test_mint,
            ctx.accounts.escrow_token_account.mint,
            ErrorCode::InvalidMint
        );
        require_keys_eq!(vault_config.sol_vault, ctx.accounts.sol_vault.key(), ErrorCode::VaultMismatchConfig);

        let oracle_feed_data = ctx
            .accounts
            .oracle_price_feed
            .try_borrow_data()
            .map_err(|_| ErrorCode::InvalidOracleFeed)?;
        let (price_value, price_confidence, exponent, price_timestamp) =
            parse_pyth_price(&oracle_feed_data)?;

        let max_age_seconds = if order.max_oracle_age_seconds == 0 {
            u64::from(vault_config.max_oracle_age_seconds)
        } else {
            u64::from(order.max_oracle_age_seconds)
        };

        let age_seconds = if now > price_timestamp {
            u64::try_from(now - price_timestamp).map_err(|_| ErrorCode::OracleDataStale)?
        } else {
            0
        };
        require!(age_seconds <= max_age_seconds, ErrorCode::OracleDataStale);

        let conf_bps = confidence_bps(price_confidence, price_value)?;
        let allowed_confidence = if order.max_confidence_bps == 0 {
            u64::from(vault_config.max_confidence_bps)
        } else {
            u64::from(order.max_confidence_bps)
        };
        require!(conf_bps <= allowed_confidence, ErrorCode::OracleConfidenceTooHigh);

        let oracle_price_e8 = pyth_price_to_e8(price_value, exponent)?;
        require!(oracle_price_e8 > 0, ErrorCode::InvalidOraclePrice);
        require!(
            order.target_price_usd_e8 >= u64::try_from(oracle_price_e8).map_err(|_| ErrorCode::InvalidOraclePrice)?,
            ErrorCode::OraclePriceTooHigh
        );

        let required_usdc = compute_required_usdc(
            order.desired_sol_lamports,
            u64::try_from(oracle_price_e8).map_err(|_| ErrorCode::InvalidOraclePrice)?,
            u32::from(vault_config.usdc_decimals),
        )?;
        require!(required_usdc > 0, ErrorCode::InvalidRequiredUsdc);
        require!(required_usdc <= order.max_usdc_in, ErrorCode::RequiredUsdcExceedsLimit);
        require!(
            required_usdc <= order.escrowed_usdc_amount,
            ErrorCode::EscrowInsufficient
        );

        let required_vault_balance = MIN_SOL_VAULT_BUFFER_LAMPORTS
            .checked_add(order.desired_sol_lamports)
            .ok_or(ErrorCode::MathOverflow)?;
        require!(
            ctx.accounts.sol_vault.lamports() >= required_vault_balance,
            ErrorCode::VaultInsufficientSol
        );

        let escrow_authority_seeds = &[
            ESCROW_AUTHORITY_SEED,
            order.to_account_info().key.as_ref(),
            &[order.escrow_authority_bump],
        ];

        let to_treasury_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.escrow_token_account.to_account_info(),
                to: ctx.accounts.treasury_usdc_ata.to_account_info(),
                authority: ctx.accounts.escrow_authority.to_account_info(),
                mint: ctx.accounts.usdc_mint.to_account_info(),
            },
            &[escrow_authority_seeds],
        );
        token::transfer_checked(to_treasury_ctx, required_usdc, vault_config.usdc_decimals)?;

        let leftover = order.escrowed_usdc_amount.checked_sub(required_usdc).ok_or(ErrorCode::MathOverflow)?;
        if leftover > 0 {
            let refund_ctx = CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.escrow_token_account.to_account_info(),
                    to: ctx.accounts.user_usdc_token_account.to_account_info(),
                    authority: ctx.accounts.escrow_authority.to_account_info(),
                    mint: ctx.accounts.usdc_mint.to_account_info(),
                },
                &[escrow_authority_seeds],
            );
            token::transfer_checked(refund_ctx, leftover, vault_config.usdc_decimals)?;
        }

        let vault_seed = &[
            SOL_VAULT_SEED,
            vault_config.key().as_ref(),
            &[vault_config.vault_bump],
        ];
        let sol_transfer_ix = system_instruction::transfer(
            &ctx.accounts.sol_vault.key(),
            &ctx.accounts.recipient.key(),
            order.desired_sol_lamports,
        );
        let sol_accounts = &[
            ctx.accounts.sol_vault.to_account_info(),
            ctx.accounts.recipient.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
        ];
        invoke_signed(&sol_transfer_ix, sol_accounts, &[vault_seed])?;

        order.status = STATUS_EXECUTED;
        order.executed_usdc_amount = required_usdc;
        order.executed_sol_lamports = order.desired_sol_lamports;
        order.escrowed_usdc_amount = 0;

        Ok(())
    }

    pub fn cancel_order(ctx: Context<CancelOrReclaimOrder>) -> Result<()> {
        require!(!ctx.accounts.vault_config.paused, ErrorCode::VaultPaused);
        require_keys_eq!(ctx.accounts.order.user, ctx.accounts.user.key(), ErrorCode::Unauthorized);
        require_eq!(ctx.accounts.order.status, STATUS_OPEN, ErrorCode::OrderNotOpen);
        require!(
            Clock::get()?.unix_timestamp <= ctx.accounts.order.expires_at,
            ErrorCode::OrderNotExpired
        );

        refund_escrow_to_user(
            &ctx.accounts.order,
            ctx.accounts.order_user_escrow_authority.key(),
            &ctx.accounts.token_program,
            &ctx.accounts.escrow_token_account,
            &ctx.accounts.user_usdc_token_account,
            &ctx.accounts.vault_config,
        )?;

        let order = &mut ctx.accounts.order;
        order.status = STATUS_CANCELLED;
        order.escrowed_usdc_amount = 0;
        Ok(())
    }

    pub fn reclaim_expired_order(ctx: Context<CancelOrReclaimOrder>) -> Result<()> {
        require!(!ctx.accounts.vault_config.paused, ErrorCode::VaultPaused);
        require_keys_eq!(ctx.accounts.order.user, ctx.accounts.user.key(), ErrorCode::Unauthorized);
        require_eq!(ctx.accounts.order.status, STATUS_OPEN, ErrorCode::OrderNotOpen);
        require!(Clock::get()?.unix_timestamp > ctx.accounts.order.expires_at, ErrorCode::OrderExpired);

        refund_escrow_to_user(
            &ctx.accounts.order,
            ctx.accounts.order_user_escrow_authority.key(),
            &ctx.accounts.token_program,
            &ctx.accounts.escrow_token_account,
            &ctx.accounts.user_usdc_token_account,
            &ctx.accounts.vault_config,
        )?;

        let order = &mut ctx.accounts.order;
        order.status = STATUS_EXPIRED;
        order.escrowed_usdc_amount = 0;
        Ok(())
    }
}

fn refund_escrow_to_user(
    order: &Order,
    escrow_authority: Pubkey,
    token_program: &Program<Token>,
    escrow_token_account: &Account<TokenAccount>,
    user_token_account: &Account<TokenAccount>,
    vault_config: &VaultConfig,
) -> Result<()> {
    if order.escrowed_usdc_amount == 0 {
        return Ok(());
    }

    let seeds = &[
        ESCROW_AUTHORITY_SEED,
        order.user.as_ref(),
        &[order.escrow_authority_bump],
    ];

    let refund_ctx = CpiContext::new_with_signer(
        token_program.to_account_info(),
        TransferChecked {
            from: escrow_token_account.to_account_info(),
            to: user_token_account.to_account_info(),
            authority: AccountInfo::new(
                &escrow_authority,
                false,
                false,
                &mut 0,
                &mut [],
                &anchor_lang::system_program::ID,
                false,
                0,
            ),
            mint: vault_config.to_account_info().try_borrow_data()???,
        },
        &[seeds],
    );

    token::transfer_checked(refund_ctx, order.escrowed_usdc_amount, vault_config.usdc_decimals)?;
    Ok(())
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct InitializeVaultConfigParams {
    pub treasury_usdc_ata: Pubkey,
    pub usdc_test_mint: Pubkey,
    pub oracle_feed: Pubkey,
    pub usdc_decimals: u8,
    pub sol_vault: Pubkey,
    pub max_oracle_age_seconds: u32,
    pub max_confidence_bps: u16,
    pub paused: bool,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct FundSolVaultParams {
    pub amount: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct CreateOrderAndDepositParams {
    pub client_order_id: u64,
    pub desired_sol_lamports: u64,
    pub max_usdc_in: u64,
    pub target_price_usd_e8: u64,
    pub expires_at: i64,
    pub recipient: Pubkey,
    pub oracle_feed: Pubkey,
    pub max_oracle_age_seconds: u32,
    pub max_confidence_bps: u16,
    pub deposit_amount: u64,
}

#[account]
pub struct VaultConfig {
    pub admin: Pubkey,
    pub treasury_usdc_ata: Pubkey,
    pub usdc_test_mint: Pubkey,
    pub oracle_feed: Pubkey,
    pub sol_vault: Pubkey,
    pub usdc_decimals: u8,
    pub max_oracle_age_seconds: u32,
    pub max_confidence_bps: u16,
    pub paused: bool,
    pub vault_bump: u8,
    pub bump: u8,
}

impl VaultConfig {
    pub const LEN: usize = 32 + 32 + 32 + 32 + 32 + 1 + 4 + 2 + 1 + 1 + 1;
}

#[account]
pub struct Order {
    pub user: Pubkey,
    pub recipient: Pubkey,
    pub client_order_id: u64,
    pub usdc_test_mint: Pubkey,
    pub escrow_token_account: Pubkey,
    pub treasury_usdc_ata: Pubkey,
    pub sol_vault_pda: Pubkey,
    pub oracle_feed: Pubkey,
    pub desired_sol_lamports: u64,
    pub max_usdc_in: u64,
    pub target_price_usd_e8: u64,
    pub max_oracle_age_seconds: u32,
    pub max_confidence_bps: u16,
    pub escrowed_usdc_amount: u64,
    pub executed_usdc_amount: u64,
    pub executed_sol_lamports: u64,
    pub created_at: i64,
    pub expires_at: i64,
    pub escrow_authority_bump: u8,
    pub status: u8,
    pub bump: u8,
}

impl Order {
    pub const LEN: usize =
        32 + 32 + 8 + 32 + 32 + 32 + 32 + 32 + 8 + 8 + 8 + 4 + 2 + 8 + 8 + 8 + 8 + 8 + 1 + 1 + 1;
}

#[derive(Accounts)]
#[instruction()]
pub struct InitializeVaultConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        init,
        payer = admin,
        space = 8 + VaultConfig::LEN,
        seeds = [VAULT_CONFIG_SEED],
        bump
    )]
    pub vault_config: Account<'info, VaultConfig>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(params: FundSolVaultParams)]
pub struct FundSolVault<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [VAULT_CONFIG_SEED],
        bump = vault_config.bump,
    )]
    pub vault_config: Account<'info, VaultConfig>,

    #[account(
        init_if_needed,
        payer = admin,
        space = 0,
        seeds = [SOL_VAULT_SEED, vault_config.key().as_ref()],
        bump = vault_config.vault_bump,
    )]
    pub sol_vault: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(params: CreateOrderAndDepositParams)]
pub struct CreateOrderAndDeposit<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        constraint = user_usdc_token_account.owner == user.key() @ ErrorCode::InvalidTokenOwner,
        constraint = user_usdc_token_account.mint == vault_config.usdc_test_mint @ ErrorCode::InvalidMint,
    )]
    pub user_usdc_token_account: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = user,
        space = 8 + Order::LEN,
        seeds = [ORDER_SEED, user.key().as_ref(), &params.client_order_id.to_le_bytes()],
        bump
    )]
    pub order: Account<'info, Order>,

    #[account(
        seeds = [ESCROW_AUTHORITY_SEED, order.key().as_ref()],
        bump
    )]
    pub escrow_authority: SystemAccount<'info>,

    #[account(
        init_if_needed,
        payer = user,
        associated_token::authority = escrow_authority,
        associated_token::mint = vault_config.usdc_test_mint,
        associated_token::token_program = token_program,
    )]
    pub escrow_token_account: Account<'info, TokenAccount>,

    #[account(
        seeds = [VAULT_CONFIG_SEED],
        bump = vault_config.bump,
    )]
    pub vault_config: Account<'info, VaultConfig>,

    #[account(
        mut,
        token::mint = vault_config.usdc_test_mint,
    )]
    pub treasury_usdc_ata: Account<'info, TokenAccount>,

    #[account(address = vault_config.usdc_test_mint)]
    pub usdc_mint: Account<'info, Mint>,

    /// CHECK: validated by key match and direct pyth parser
    pub oracle_price_feed: AccountInfo<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ExecuteOrder<'info> {
    /// CHECK: permissionless execution caller
    pub executor: Signer<'info>,

    #[account(mut)]
    pub order: Account<'info, Order>,

    #[account(
        mut,
        seeds = [VAULT_CONFIG_SEED],
        bump = vault_config.bump,
    )]
    pub vault_config: Account<'info, VaultConfig>,

    #[account(mut)]
    pub recipient: SystemAccount<'info>,

    #[account(
        mut,
        seeds = [SOL_VAULT_SEED, vault_config.key().as_ref()],
        bump = vault_config.vault_bump,
    )]
    pub sol_vault: SystemAccount<'info>,

    #[account(
        mut,
        constraint = escrow_token_account.key() == order.escrow_token_account @ ErrorCode::InvalidEscrowAccount,
        constraint = escrow_token_account.mint == vault_config.usdc_test_mint @ ErrorCode::InvalidMint,
    )]
    pub escrow_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = vault_config.usdc_test_mint,
    )]
    pub treasury_usdc_ata: Account<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = vault_config.usdc_test_mint,
        constraint = user_usdc_token_account.owner == order.user @ ErrorCode::InvalidTokenOwner,
    )]
    pub user_usdc_token_account: Account<'info, TokenAccount>,

    #[account(address = vault_config.usdc_test_mint)]
    pub usdc_mint: Account<'info, Mint>,

    /// CHECK: validated by key match
    #[account(address = order.oracle_feed)]
    pub oracle_price_feed: AccountInfo<'info>,

    #[account(
        seeds = [ESCROW_AUTHORITY_SEED, order.key().as_ref()],
        bump = order.escrow_authority_bump,
    )]
    pub escrow_authority: SystemAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CancelOrReclaimOrder<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(mut)]
    pub order: Account<'info, Order>,

    #[account(
        seeds = [VAULT_CONFIG_SEED],
        bump = vault_config.bump,
    )]
    pub vault_config: Account<'info, VaultConfig>,

    #[account(
        mut,
        constraint = escrow_token_account.key() == order.escrow_token_account @ ErrorCode::InvalidEscrowAccount,
        constraint = escrow_token_account.mint == vault_config.usdc_test_mint @ ErrorCode::InvalidMint,
    )]
    pub escrow_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = vault_config.usdc_test_mint,
        constraint = user_usdc_token_account.owner == order.user @ ErrorCode::InvalidTokenOwner,
    )]
    pub user_usdc_token_account: Account<'info, TokenAccount>,

    #[account(
        #[account(mut, token::mint = vault_config.usdc_test_mint)]
        address = vault_config.usdc_test_mint
    )]
    pub usdc_mint: Account<'info, Mint>,

    #[account(
        seeds = [ESCROW_AUTHORITY_SEED, order.key().as_ref()],
        bump = order.escrow_authority_bump,
    )]
    pub order_user_escrow_authority: SystemAccount<'info>,

    pub token_program: Program<'info, Token>,
}

fn parse_pyth_price(data: &[u8]) -> Result<(i64, u64, i32, i64)> {
    if data.len() < PYTH_PRICE_ACCOUNT_SIZE {
        return Err(ErrorCode::InvalidOracleFeed.into());
    }

    let magic = u32::from_le_bytes(data[0..4].try_into().map_err(|_| ErrorCode::InvalidOracleFeed)?);
    require!(magic == PYTH_MAGIC, ErrorCode::InvalidOracleFeed);

    let version = u32::from_le_bytes(data[4..8].try_into().map_err(|_| ErrorCode::InvalidOracleFeed)?);
    require!(version == PYTH_VERSION, ErrorCode::InvalidOracleFeed);

    let price_type = u32::from_le_bytes(data[8..12].try_into().map_err(|_| ErrorCode::InvalidOracleFeed)?);
    require!(price_type == PYTH_PRICE_TYPE, ErrorCode::InvalidOracleFeed);

    let exponent = i32::from_le_bytes(data[20..24].try_into().map_err(|_| ErrorCode::InvalidOracleFeed)?);
    let status = u32::from_le_bytes(data[224..228].try_into().map_err(|_| ErrorCode::InvalidOracleFeed)?);
    require!(status == 1, ErrorCode::OracleDataStale);

    let price = i64::from_le_bytes(data[208..216].try_into().map_err(|_| ErrorCode::InvalidOracleFeed)?);
    let confidence = u64::from_le_bytes(data[216..224].try_into().map_err(|_| ErrorCode::InvalidOracleFeed)?);
    let timestamp = i64::from_le_bytes(data[296..304].try_into().map_err(|_| ErrorCode::InvalidOracleFeed)?);

    Ok((price, confidence, exponent, timestamp))
}

fn pyth_price_to_e8(price: i64, exponent: i32) -> Result<i64> {
    require!(price > 0, ErrorCode::InvalidOraclePrice);
    let value = i128::from(price);
    if exponent == -8 {
        return Ok(i64::try_from(value).map_err(|_| ErrorCode::OracleInvalidPrecision)?);
    }

    if exponent < -8 {
        let exp = u32::try_from((-exponent - 8)).map_err(|_| ErrorCode::OraclePowOverflow)?;
        let factor = 10_i128
            .checked_pow(exp)
            .ok_or(ErrorCode::OraclePowOverflow)?;
        return Ok(i64::try_from(value / factor).map_err(|_| ErrorCode::OracleInvalidPrecision)?);
    }

    let exp = u32::try_from(exponent + 8).map_err(|_| ErrorCode::OraclePowOverflow)?;
    let factor = 10_i128
        .checked_pow(exp)
        .ok_or(ErrorCode::OraclePowOverflow)?;
    i64::try_from(value * factor).map_err(|_| ErrorCode::OracleInvalidPrecision.into())
}

fn confidence_bps(confidence: u64, price: i64) -> Result<u64> {
    let price_abs = i128::from(price).abs() as u128;
    require!(price_abs > 0, ErrorCode::OracleInvalidPrecision);

    let conf_scaled = u128::from(confidence)
        .checked_mul(10_000)
        .ok_or(ErrorCode::OracleInvalidPrecision)?;
    let bps = conf_scaled.checked_div(price_abs).ok_or(ErrorCode::OracleInvalidPrecision)?;
    u64::try_from(bps).map_err(|_| ErrorCode::OracleInvalidPrecision.into())
}

fn compute_required_usdc(desired_sol_lamports: u64, oracle_price_e8: u64, usdc_decimals: u32) -> Result<u64> {
    let desired_sol_lamports = u128::from(desired_sol_lamports);
    let price_e8 = u128::from(oracle_price_e8);
    let usdc_scale = 10_u128
        .checked_pow(usdc_decimals)
        .ok_or(ErrorCode::InvalidUsdcDecimals)?;
    let denominator = (LAMPORTS_PER_SOL as u128)
        .checked_mul(10_00000000_u128)
        .ok_or(ErrorCode::MathOverflow)?;

    let numerator = desired_sol_lamports
        .checked_mul(price_e8)
        .ok_or(ErrorCode::MathOverflow)?
        .checked_mul(usdc_scale)
        .ok_or(ErrorCode::MathOverflow)?;

    let rounded = numerator
        .checked_add(denominator.saturating_sub(1))
        .ok_or(ErrorCode::MathOverflow)?
        .checked_div(denominator)
        .ok_or(ErrorCode::MathOverflow)?;

    u64::try_from(rounded).map_err(|_| ErrorCode::MathOverflow.into())
}

#[error_code]
pub enum ErrorCode {
    #[msg("Vault config is paused")]
    VaultPaused,
    #[msg("Invalid client order id")]
    InvalidClientOrderId,
    #[msg("Invalid desired SOL amount")]
    InvalidDesiredSolAmount,
    #[msg("Invalid max USDC")]
    InvalidMaxUsdcIn,
    #[msg("Invalid target price")]
    InvalidTargetPrice,
    #[msg("Invalid deposit amount")]
    InvalidDepositAmount,
    #[msg("Deposit exceeds max USDC")]
    DepositExceedsMaxUsdc,
    #[msg("Invalid oracle age")]
    InvalidOracleAge,
    #[msg("Invalid oracle confidence")]
    InvalidConfidenceBps,
    #[msg("Order is not executable in current state")]
    OrderNotOpen,
    #[msg("Order has expired")]
    OrderExpired,
    #[msg("Invalid recipient")]
    InvalidRecipient,
    #[msg("Oracle feed mismatch")]
    OracleFeedMismatch,
    #[msg("Vault config mismatch")]
    VaultMismatchConfig,
    #[msg("Invalid escrow authority key")]
    InvalidEscrowAccount,
    #[msg("Invalid oracle feed format")]
    InvalidOracleFeed,
    #[msg("Oracle data stale")]
    OracleDataStale,
    #[msg("Invalid oracle price")]
    InvalidOraclePrice,
    #[msg("Oracle price is above target")]
    OraclePriceTooHigh,
    #[msg("Invalid mint")]
    InvalidMint,
    #[msg("Invalid token account owner")]
    InvalidTokenOwner,
    #[msg("Treasury ATA mismatch")]
    TreasuryAtaMismatch,
    #[msg("Invalid required USDC calculation")]
    InvalidRequiredUsdc,
    #[msg("Max confidence bps exceeds allowed range")]
    InvalidConfidenceBpsRange,
    #[msg("Required USDC exceeds user max")]
    RequiredUsdcExceedsLimit,
    #[msg("Escrow account has insufficient USDC")]
    EscrowInsufficient,
    #[msg("Vault lacks SOL balance")]
    VaultInsufficientSol,
    #[msg("USDC decimals are unsupported")]
    InvalidUsdcDecimals,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Oracle exponent overflow")]
    OraclePowOverflow,
    #[msg("Invalid precision for confidence computation")]
    OracleInvalidPrecision,
    #[msg("Order has not expired yet")]
    OrderNotExpired,
    #[msg("Order has already been executed or reclaimed")]
    OrderNotPending,
    #[msg("Caller is not authorized")]
    Unauthorized,
    #[msg("Insufficient admin SOL")]
    InsufficientAdminSol,
    #[msg("Vault transfer failed")]
    VaultTransferFailed,
    #[msg("Invalid fund amount")]
    InvalidFundAmount,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_required_usdc_math_rounding_up() {
        let required = compute_required_usdc(1_000_000_000, 120_00000000, 6).unwrap();
        assert_eq!(required, 120_000_000);

        let required_small = compute_required_usdc(1, 120_00000000, 6).unwrap();
        assert_eq!(required_small, 1);
    }
}

-- Optional demo data so the dashboard/bot can be exercised without live RPC endpoints.
--   docker compose exec -T postgres psql -U whaleradar -d whaleradar < db/demo_seed.sql
INSERT INTO tokens (chain_id, address, symbol, decimals) VALUES
  (1,  '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', 'WETH', 18),
  (1,  '0x6982508145454ce325ddbe47a25d4ec3d2311933', 'PEPE', 18),
  (56, '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', 'WBNB', 18),
  (42161, '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', 'WETH', 18)
ON CONFLICT DO NOTHING;

INSERT INTO transfers (chain_id, tx_hash, log_index, block_number, seen_at, token, token_symbol,
                       from_address, to_address, from_label, to_label, amount, price_usd, amount_usd, direction)
VALUES
  (1, '0xdemo1', 0, 21000001, now() - interval '4 minutes',
   '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', 'WETH',
   '0x28C6c06298d514Db089934071355E5743bf21d60', '0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b',
   'Binance 14', '', 1250, 3120, 3900000, 'cex_withdrawal'),
  (1, '0xdemo2', 1, 21000004, now() - interval '22 minutes',
   '0x6982508145454ce325ddbe47a25d4ec3d2311933', 'PEPE',
   '0xa43fe16908251ee70ef74718545e4fe6c5ccec9f', '0x9f1c8b2a3d4e5f60718293a4b5c6d7e8f9a0b1c2',
   'Uniswap V2 pool', '', 82000000000, 0.0000098, 803600, 'dex_buy'),
  (56, '0xdemo3', 0, 44000010, now() - interval '55 minutes',
   '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', 'WBNB',
   '0x2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e', '0xF977814e90dA44bFA03b6295A0616a897441aceC',
   '', 'Binance hot wallet', 1900, 580, 1102000, 'cex_deposit'),
  (42161, '0xdemo4', 2, 250000123, now() - interval '3 hours',
   '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', 'WETH',
   '0x4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f70', '0xc873fEcbd354f5A56E00E710B90EF4201db2448d',
   '', 'Camelot V2 pool', 210, 3120, 655200, 'dex_sell')
ON CONFLICT DO NOTHING;

INSERT INTO pools (chain_id, address, factory, dex, version, token0, token1, fee_tier, block_number, tx_hash, created_at)
VALUES
  (1, '0x5f6a7b8c9d0e1f2a3b4c5d6e7f8091a2b3c4d5e6', '0x1F98431c8aD98523631AE4a59f267346ea31F984',
   'Uniswap', 'v3', '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', '0x6982508145454ce325ddbe47a25d4ec3d2311933',
   3000, 21000002, '0xdemopool1', now() - interval '35 minutes'),
  (137, '0x6a7b8c9d0e1f2a3b4c5d6e7f8091a2b3c4d5e6f7', '0x5757371414417b7702ED1a912380ec961e188671',
   'QuickSwap', 'v2', '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
   0, 63000004, '0xdemopool2', now() - interval '2 hours')
ON CONFLICT DO NOTHING;

INSERT INTO bot_users (telegram_id, username, tier, min_usd)
VALUES (11111111, 'demo_vip', 'vip', 250000), (22222222, 'demo_free', 'free', 100000)
ON CONFLICT DO NOTHING;

-- Seed exchange / market maker labels. Mirrors apps/listener/internal/tagging/seed.go
-- so the listener works even before the admin panel is used. chain_id = 0 means
-- "applies to every chain".
INSERT INTO wallet_tags (chain_id, address, label, category) VALUES
    (1, '0x3f5CE5FBFe3E9af3971dD833D26bA9b5C936f0bE', 'Binance 1', 'cex'),
    (1, '0xD551234Ae421e3BCBA99A0Da6d736074f22192FF', 'Binance 2', 'cex'),
    (1, '0x564286362092D8e7936f0549571a803B203aAceD', 'Binance 3', 'cex'),
    (1, '0x0681d8Db095565FE8A346fA0277bFfdE9C0eDBBF', 'Binance 4', 'cex'),
    (1, '0xF977814e90dA44bFA03b6295A0616a897441aceC', 'Binance 8 (Hot)', 'cex'),
    (1, '0x28C6c06298d514Db089934071355E5743bf21d60', 'Binance 14 (Hot)', 'cex'),
    (1, '0x21a31Ee1afC51d94C2eFcCAa2092aD1028285549', 'Binance 15 (Hot)', 'cex'),
    (1, '0xDFd5293D8e347dFe59E90eFd55b2956a1343963d', 'Binance 16 (Hot)', 'cex'),
    (1, '0x56Eddb7aa87536c09CCc2793473599fD21A8b17F', 'Binance 17 (Hot)', 'cex'),
    (1, '0x9696f59E4d72E237BE84fFD425DCaD154Bf96976', 'Binance 18 (Hot)', 'cex'),
    (56, '0x8894E0a0c962CB723c1976a4421c95949bE2D4E3', 'Binance BSC Hot', 'cex'),
    (56, '0xF977814e90dA44bFA03b6295A0616a897441aceC', 'Binance 8 (Hot)', 'cex'),
    (137, '0xF977814e90dA44bFA03b6295A0616a897441aceC', 'Binance 8 (Hot)', 'cex'),
    (42161, '0xF977814e90dA44bFA03b6295A0616a897441aceC', 'Binance 8 (Hot)', 'cex'),
    (1, '0x71660c4005BA85c37ccec55d0C4493E66Fe775d3', 'Coinbase 1', 'cex'),
    (1, '0x503828976D22510aad0201ac7EC88293211D23Da', 'Coinbase 2', 'cex'),
    (1, '0xddfAbCdc4D8FfC6d5beaf154f18B778f892A0740', 'Coinbase 3', 'cex'),
    (1, '0x3cD751E6b0078Be393132286c442345e5DC49699', 'Coinbase 4', 'cex'),
    (1, '0xA9D1e08C7793af67e9d92fe308d5697FB81d3E43', 'Coinbase 10 (Hot)', 'cex'),
    (1, '0x2910543Af39abA0Cd09dBb2D50200b3E800A63D2', 'Kraken 1', 'cex'),
    (1, '0x0A869d79a7052C7f1b55a8EbAbbEa3420F0D1E13', 'Kraken 2', 'cex'),
    (1, '0xE853c56864A2ebe4576a807D26Fdc4A0adA51919', 'Kraken 3', 'cex'),
    (1, '0x267be1C1D684F78cb4F6a176C4911b741E4Ffdc0', 'Kraken 4', 'cex'),
    (1, '0xFa52274DD61E1643d2205169732f29114BC240b3', 'Kraken 5', 'cex'),
    (1, '0x0000006daea1723962647b7e189d311d757Fb793', 'Wintermute', 'market_maker'),
    (1, '0x4f3a120E72C76c22ae802D129F599BFDbc31cb81', 'Wintermute 2', 'market_maker'),
    (0, '0x000000000000000000000000000000000000dEaD', 'Burn', 'burn')
ON CONFLICT (chain_id, address) DO UPDATE
SET label = EXCLUDED.label, category = EXCLUDED.category, updated_at = now();

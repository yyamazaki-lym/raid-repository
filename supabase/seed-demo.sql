-- ============================================================================
-- Raid Repository — Demo-only seed data
--
-- Apply this AFTER schema.sql on the DEMO project ONLY.
-- DO NOT apply on production / actual fork projects — demo data will pollute
-- your live raid repository.
--
-- Idempotent: contains its own re-run guards (ON CONFLICT / sentinel /
-- URL NOT EXISTS), so re-applying on the demo project is safe.
--
-- 履歴:
--   - 2026-05-01 (TODO #8 part C-ii): schema.sql 12 章として初投入
--   - 2026-05-01 (TODO #8 follow-up): schema.sql 13 章前半に追加コンテンツ seed
--   - 2026-05-08 (TODO #76): schema.sql から本ファイルに分離
--     (新章追加ごとの再ガード負担と本番誤適用リスクを根治するため)
--   - 2026-05-08 (TODO #76 follow-up): 旧 schema.sql Section 11 (sample 7
--     categories) も demo 扱いに格上げして本ファイルに移管
--     (本番 fork では空 portal の方が望ましいというユーザー判断)
-- ============================================================================

-- ---- 0. Sample seed categories (was schema.sql Section 11) ----------------
-- 旧 TODO #8 (2.1, 2026-05-01): demo 環境で空 portal だと使い方が掴みにくい
-- ため、サンプルカテゴリ 7 件を投入する。実コンテンツ名 (現行零式 + Variant
-- + Extreme + Ultimate 2 件) を入れて status 4 種類を一通りカバー。
-- ON CONFLICT (slug) DO NOTHING で既存値は上書きしないので、再実行・編集後
-- の再 apply でも安全。Section 1 の demo bulk seed はこれら 7 件のうち 5 件
-- に紐付くので必ず本セクションを先に走らせる。
INSERT INTO public.categories (slug, name, status, sort_order) VALUES
  ('arcadion-heavy',            '至天の座アルカディア：ヘビー級',         '練習中',   10),
  ('arcadion-cruiser',          '至天の座アルカディア：クルーザー級',     '練習中',   11),
  ('arcadion-lightheavy',       '至天の座アルカディア：ライトヘビー級',   '未着手',   12),
  ('variant-shokyaku',          '異聞商客物語',                           '未着手',   20),
  ('extreme-cloud-of-darkness', '滅暗闇の雲激闘戦',                       'クリア済', 30),
  ('ultimate-omega-protocol',   '絶オメガ検証戦',                         '未着手',   40),
  ('ultimate-futures-rewritten','絶もうひとつの未来',                     '休止中',   50)
ON CONFLICT (slug) DO NOTHING;

-- ---- 1. Demo data bulk seed (was schema.sql Section 12) -------------------
-- モックサイト見栄え用の demo data 一括投入。Section 0 のサンプル 5
-- カテゴリ (arcadion-heavy / variant-shokyaku / extreme-cloud-of-darkness
-- / ultimate-omega-protocol / ultimate-futures-rewritten) に紐付ける形で
-- 残り 10 テーブル (category_links / loot_items / loot_entries /
-- mitigation_phases / mitigation_entries / strategy_docs / category_macros
-- / recruitment_templates / tags / schedule_past_sessions /
-- schedule_session_memos / app_settings) に bulk insert する。
--
-- 設計方針 (TODO #8 で承認済):
--   - demo project 専用。本番 fork では本ファイルを apply しない
--   - 誤って入った場合は TODO #23「全データ初期化」ボタンで一括削除可能
--   - 冪等: app_settings の sentinel `demo_seed_applied=1` で 2 回目以降スキップ
--   - 全データ初期化で app_settings 行も消えるので、init 直後の再 apply
--     で復活する = リカバリ手段として動作

DO $$
DECLARE
  v_arc uuid;  -- arcadion-heavy (練習中)
  v_var uuid;  -- variant-shokyaku (未着手)
  v_ext uuid;  -- extreme-cloud-of-darkness (クリア済)
  v_omg uuid;  -- ultimate-omega-protocol (未着手)
  v_fru uuid;  -- ultimate-futures-rewritten (休止中)
  v_phase uuid;
  v_item uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM public.app_settings WHERE key = 'demo_seed_applied') THEN
    RAISE NOTICE 'Demo seed already applied — skipping.';
    RETURN;
  END IF;

  SELECT id INTO v_arc FROM public.categories WHERE slug = 'arcadion-heavy';
  SELECT id INTO v_var FROM public.categories WHERE slug = 'variant-shokyaku';
  SELECT id INTO v_ext FROM public.categories WHERE slug = 'extreme-cloud-of-darkness';
  SELECT id INTO v_omg FROM public.categories WHERE slug = 'ultimate-omega-protocol';
  SELECT id INTO v_fru FROM public.categories WHERE slug = 'ultimate-futures-rewritten';

  IF v_arc IS NULL OR v_var IS NULL OR v_ext IS NULL OR v_omg IS NULL OR v_fru IS NULL THEN
    RAISE NOTICE 'Section 0 sample categories missing — skipping demo seed.';
    RETURN;
  END IF;

  -- ---- 1.1 categories: enrich existing 5 rows ----
  UPDATE public.categories SET
    description = '現行零式・週固定運営。LH 級コンプリート後の継続コンテンツ。',
    fflogs_match_keywords = ARRAY['ヘビー','heavy','M5S','M6S','M7S','M8S']
  WHERE id = v_arc;

  UPDATE public.categories SET
    description = '8 名 PT 用の異聞 raid。武器は出ないが防具・素材狙いで周回中。',
    fflogs_match_keywords = ARRAY['異聞','商客','variant']
  WHERE id = v_var;

  UPDATE public.categories SET
    description = '極コンテンツ — 撃破済。武器目当てに不定期周回。',
    first_clear_at = '2026-02-18T22:14:30+09:00',
    manual_time_to_clear_seconds = 18000,
    fflogs_match_keywords = ARRAY['暗闇の雲','cloud of darkness']
  WHERE id = v_ext;

  UPDATE public.categories SET
    description = '絶級コンテンツ。次クール本格挑戦予定、現在は事前学習フェーズ。',
    fflogs_match_keywords = ARRAY['オメガ','omega protocol','TOP']
  WHERE id = v_omg;

  UPDATE public.categories SET
    description = '絶級コンテンツ — メンバー復帰待ちで一時休止中。',
    manual_time_to_clear_seconds = 144000,
    fflogs_match_keywords = ARRAY['もうひとつの未来','futures rewritten','FRU']
  WHERE id = v_fru;

  -- ---- 1.2 category_links: strategy (12 件) ----
  INSERT INTO public.category_links (category_id, kind, title, url, description, sort_order, source) VALUES
    (v_arc, 'strategy', 'M5S 攻略 wiki',           'https://example.com/strategy/m5s',           '基本ギミック解説',          0, 'manual'),
    (v_arc, 'strategy', 'M6S 散開図',              'https://example.com/strategy/m6s-pos',       'デバフ散開位置の図解',      1, 'manual'),
    (v_arc, 'strategy', 'M7S タイムライン',         'https://example.com/strategy/m7s-tl',        '軽減合わせ用 TL',           2, 'manual'),
    (v_var, 'strategy', '異聞商客物語 攻略まとめ',   'https://example.com/strategy/variant',       'ルート分岐込み',            0, 'manual'),
    (v_var, 'strategy', '異聞 ボス挙動表',           'https://example.com/strategy/variant-boss',  '',                          1, 'manual'),
    (v_ext, 'strategy', '極暗闇の雲 攻略',           'https://example.com/strategy/cot',           '基本散開のみ',              0, 'manual'),
    (v_ext, 'strategy', '極暗闇の雲 マクロまとめ',   'https://example.com/strategy/cot-macros',    '',                          1, 'manual'),
    (v_omg, 'strategy', '絶オメガ検証戦 全体像',     'https://example.com/strategy/top-overview',  'P1〜P6 概要',               0, 'manual'),
    (v_omg, 'strategy', '絶オメガ P3 PROTEAN',      'https://example.com/strategy/top-p3',        '個別フェーズ詳細',          1, 'manual'),
    (v_omg, 'strategy', '絶オメガ DPS チェック',     'https://example.com/strategy/top-dps',       '',                          2, 'manual'),
    (v_fru, 'strategy', '絶もうひとつの未来 攻略',    'https://example.com/strategy/fru',           '基本ギミック解説',          0, 'manual'),
    (v_fru, 'strategy', 'FRU タイムライン',          'https://example.com/strategy/fru-tl',        '軽減合わせ',                1, 'manual');

  -- ---- 1.3 category_links: video (25 件) ----
  -- YouTube ID は demo placeholder。実 fork ではアップロード時に上書きされる想定。
  INSERT INTO public.category_links (category_id, kind, title, url, logs_url, description, sort_order, source, duration_seconds, posted_at, is_favorite) VALUES
    (v_arc, 'video', '【M5S】初回挑戦 / 2026-04-08',     'https://www.youtube.com/watch?v=demoARC01aaa', 'https://www.fflogs.com/reports/demoARC01aaaaaa', '', 0, 'discord', 7200,  '2026-04-08T22:30:00+09:00', false),
    (v_arc, 'video', '【M5S】2026-04-15',                 'https://www.youtube.com/watch?v=demoARC02aaa', 'https://www.fflogs.com/reports/demoARC02aaaaaa', '', 1, 'discord', 8100,  '2026-04-15T22:30:00+09:00', false),
    (v_arc, 'video', '【M6S】2026-04-22 デバフ確認',       'https://www.youtube.com/watch?v=demoARC03aaa', 'https://www.fflogs.com/reports/demoARC03aaaaaa', '練習回',                       2, 'discord', 9300,  '2026-04-22T22:30:00+09:00', true),
    (v_arc, 'video', '【M6S】2026-04-29 後半詰め',         'https://www.youtube.com/watch?v=demoARC04aaa', 'https://www.fflogs.com/reports/demoARC04aaaaaa', '',                              3, 'discord', 8700,  '2026-04-29T22:30:00+09:00', false),
    (v_arc, 'video', '【M7S】お試し見学会',                'https://www.youtube.com/watch?v=demoARC05aaa', NULL,                                              '雑談多め',                     4, 'manual',  4200,  '2026-04-26T21:00:00+09:00', false),
    (v_arc, 'video', '【M5S】クリア / 2026-04-30',         'https://www.youtube.com/watch?v=demoARC06aaa', 'https://www.fflogs.com/reports/demoARC06aaaaaa', '初クリア',                     5, 'discord', 6500,  '2026-04-30T22:30:00+09:00', true),
    (v_var, 'video', '【異聞】Aルート 2026-04-12',         'https://www.youtube.com/watch?v=demoVAR01aaa', NULL,                                              '',                              0, 'discord', 5400,  '2026-04-12T20:00:00+09:00', false),
    (v_var, 'video', '【異聞】Bルート 2026-04-19',         'https://www.youtube.com/watch?v=demoVAR02aaa', NULL,                                              'B 経由 ノーミス',              1, 'discord', 4800,  '2026-04-19T20:00:00+09:00', true),
    (v_var, 'video', '【異聞】Cルート 2026-04-26',         'https://www.youtube.com/watch?v=demoVAR03aaa', NULL,                                              '',                              2, 'discord', 5100,  '2026-04-26T20:00:00+09:00', false),
    (v_ext, 'video', '【極暗闇】初回見学 2026-02-04',       'https://www.youtube.com/watch?v=demoEXT01aaa', 'https://www.fflogs.com/reports/demoEXT01aaaaaa', '',                              0, 'discord', 3600,  '2026-02-04T22:00:00+09:00', false),
    (v_ext, 'video', '【極暗闇】2026-02-11',                'https://www.youtube.com/watch?v=demoEXT02aaa', 'https://www.fflogs.com/reports/demoEXT02aaaaaa', '',                              1, 'discord', 4500,  '2026-02-11T22:00:00+09:00', false),
    (v_ext, 'video', '【極暗闇】クリア 2026-02-18',          'https://www.youtube.com/watch?v=demoEXT03aaa', 'https://www.fflogs.com/reports/demoEXT03aaaaaa', '初クリア記念',                 2, 'discord', 3900,  '2026-02-18T22:14:30+09:00', true),
    (v_ext, 'video', '【極暗闇】武器周回 2026-03-04',        'https://www.youtube.com/watch?v=demoEXT04aaa', NULL,                                              '',                              3, 'manual',  2700,  '2026-03-04T22:00:00+09:00', false),
    (v_ext, 'video', '【極暗闇】武器周回 2026-03-25',        'https://www.youtube.com/watch?v=demoEXT05aaa', NULL,                                              '',                              4, 'manual',  2400,  '2026-03-25T22:00:00+09:00', false),
    (v_omg, 'video', '【絶オメガ】予習会 2026-04-05',        'https://www.youtube.com/watch?v=demoOMG01aaa', 'https://www.fflogs.com/reports/demoOMG01aaaaaa', 'P1 のみ',                      0, 'discord', 9600,  '2026-04-05T22:00:00+09:00', true),
    (v_omg, 'video', '【絶オメガ】P1 詰め 2026-04-12',        'https://www.youtube.com/watch?v=demoOMG02aaa', 'https://www.fflogs.com/reports/demoOMG02aaaaaa', '',                              1, 'discord', 10200, '2026-04-12T22:00:00+09:00', false),
    (v_omg, 'video', '【絶オメガ】P2 突入 2026-04-19',        'https://www.youtube.com/watch?v=demoOMG03aaa', 'https://www.fflogs.com/reports/demoOMG03aaaaaa', '',                              2, 'discord', 11400, '2026-04-19T22:00:00+09:00', false),
    (v_omg, 'video', '【絶オメガ】P3 PROTEAN 2026-04-26',     'https://www.youtube.com/watch?v=demoOMG04aaa', 'https://www.fflogs.com/reports/demoOMG04aaaaaa', '事故あり',                     3, 'discord', 10800, '2026-04-26T22:00:00+09:00', false),
    (v_omg, 'video', '【絶オメガ】予習動画 解説',            'https://www.youtube.com/watch?v=demoOMG05aaa', NULL,                                              '事前学習用',                   4, 'manual',  1800,  '2026-04-01T12:00:00+09:00', false),
    (v_omg, 'video', '【絶オメガ】P4 突入 2026-04-29',        'https://www.youtube.com/watch?v=demoOMG06aaa', 'https://www.fflogs.com/reports/demoOMG06aaaaaa', '',                              5, 'discord', 11700, '2026-04-29T22:00:00+09:00', true),
    (v_fru, 'video', '【FRU】P1 詰め 2026-01-14',            'https://www.youtube.com/watch?v=demoFRU01aaa', 'https://www.fflogs.com/reports/demoFRU01aaaaaa', '',                              0, 'discord', 11400, '2026-01-14T22:00:00+09:00', false),
    (v_fru, 'video', '【FRU】P2 突入 2026-01-28',            'https://www.youtube.com/watch?v=demoFRU02aaa', 'https://www.fflogs.com/reports/demoFRU02aaaaaa', '',                              1, 'discord', 12000, '2026-01-28T22:00:00+09:00', false),
    (v_fru, 'video', '【FRU】P3 詰め 2026-02-11',            'https://www.youtube.com/watch?v=demoFRU03aaa', 'https://www.fflogs.com/reports/demoFRU03aaaaaa', '',                              2, 'discord', 11700, '2026-02-11T22:00:00+09:00', true),
    (v_fru, 'video', '【FRU】P4 ULTIMATE RELATIVITY',       'https://www.youtube.com/watch?v=demoFRU04aaa', 'https://www.fflogs.com/reports/demoFRU04aaaaaa', '休止前 最終練習',              3, 'discord', 12600, '2026-02-25T22:00:00+09:00', false),
    (v_fru, 'video', '【FRU】解説動画',                      'https://www.youtube.com/watch?v=demoFRU05aaa', NULL,                                              '',                              4, 'manual',  2700,  '2026-01-10T12:00:00+09:00', false);

  -- ---- 1.4 loot_items + loot_entries ----
  -- Helper: loot を category 1 つにつき主要装備スロット軸で投入。
  -- entries は status 4 種類 (次優先 / 辞退 / 取得済 / 未定) を均等にローテ。

  -- arcadion-heavy: 8 items
  INSERT INTO public.loot_items (category_id, name, slot, sort_order) VALUES
    (v_arc, 'M5S 詩学耳飾り',   '耳', 0),
    (v_arc, 'M5S 詩学首飾り',   '首', 1),
    (v_arc, 'M6S 詩学腕輪',     '腕', 2),
    (v_arc, 'M6S 詩学指輪',     '指', 3),
    (v_arc, 'M7S 詩学頭防具',   '頭', 4),
    (v_arc, 'M7S 詩学胴防具',   '胴', 5),
    (v_arc, 'M8S 詩学武器',     '武器', 6),
    (v_arc, 'M8S 詩学脚防具',   '脚', 7);

  -- arcadion: entries (item ごとに 2 名)
  FOR v_item IN SELECT id FROM public.loot_items WHERE category_id = v_arc ORDER BY sort_order LOOP
    INSERT INTO public.loot_entries (loot_item_id, player_name, status, note) VALUES
      (v_item, 'アルファ', '次優先', NULL),
      (v_item, 'ブラボー', '未定',   NULL);
  END LOOP;

  -- 数件だけ取得済 / 辞退に変える (見栄え)
  UPDATE public.loot_entries SET status = '取得済', note = '2026-04-08 取得'
    WHERE player_name = 'アルファ'
      AND loot_item_id IN (SELECT id FROM public.loot_items WHERE category_id = v_arc AND sort_order IN (0, 2));
  UPDATE public.loot_entries SET status = '辞退'
    WHERE player_name = 'ブラボー'
      AND loot_item_id IN (SELECT id FROM public.loot_items WHERE category_id = v_arc AND sort_order = 4);

  -- variant: 装備出ないが報酬枠 2 件
  INSERT INTO public.loot_items (category_id, name, slot, sort_order) VALUES
    (v_var, '異聞商客物語 鞄飾り', 'その他', 0),
    (v_var, '異聞商客物語 称号',   'その他', 1);

  FOR v_item IN SELECT id FROM public.loot_items WHERE category_id = v_var ORDER BY sort_order LOOP
    INSERT INTO public.loot_entries (loot_item_id, player_name, status, note) VALUES
      (v_item, 'チャーリー', '次優先', NULL),
      (v_item, 'デルタ',     '未定',   NULL);
  END LOOP;

  -- extreme: 武器 1 / マウント 1 / マテリア 2 = 4 items
  INSERT INTO public.loot_items (category_id, name, slot, sort_order) VALUES
    (v_ext, '極暗闇の雲 武器',         '武器', 0),
    (v_ext, '極暗闇の雲 マウント',     'マウント', 1),
    (v_ext, '極暗闇の雲 ペット',       'ペット',   2),
    (v_ext, '極暗闇の雲 オーケストリオン', 'その他', 3);

  FOR v_item IN SELECT id FROM public.loot_items WHERE category_id = v_ext ORDER BY sort_order LOOP
    INSERT INTO public.loot_entries (loot_item_id, player_name, status, note) VALUES
      (v_item, 'エコー',   '次優先', NULL),
      (v_item, 'フォックス', '取得済', '2026-02-18 初クリア時');
  END LOOP;

  -- ultimate-omega-protocol: 武器 + マウント
  INSERT INTO public.loot_items (category_id, name, slot, sort_order) VALUES
    (v_omg, '絶オメガ検証戦 武器', '武器',     0),
    (v_omg, '絶オメガ マウント',   'マウント', 1);

  FOR v_item IN SELECT id FROM public.loot_items WHERE category_id = v_omg ORDER BY sort_order LOOP
    INSERT INTO public.loot_entries (loot_item_id, player_name, status, note) VALUES
      (v_item, 'ゴルフ', '次優先', NULL),
      (v_item, 'ホテル', '未定',   NULL);
  END LOOP;

  -- ultimate-futures-rewritten: 武器 + マウント
  INSERT INTO public.loot_items (category_id, name, slot, sort_order) VALUES
    (v_fru, '絶もうひとつの未来 武器',   '武器',     0),
    (v_fru, '絶もうひとつの未来 マウント', 'マウント', 1);

  FOR v_item IN SELECT id FROM public.loot_items WHERE category_id = v_fru ORDER BY sort_order LOOP
    INSERT INTO public.loot_entries (loot_item_id, player_name, status, note) VALUES
      (v_item, 'アルファ',   '次優先', NULL),
      (v_item, 'チャーリー', '辞退',   '休止中');
  END LOOP;

  -- ---- 1.5 mitigation_phases + mitigation_entries ----
  -- arcadion-heavy: 4 phase
  INSERT INTO public.mitigation_phases (category_id, name, sort_order) VALUES (v_arc, 'P1 開幕', 0) RETURNING id INTO v_phase;
  INSERT INTO public.mitigation_entries (phase_id, time_label, mechanic, player_name, skill, note, sort_order) VALUES
    (v_phase, '0:08',  'オートアタック',     '全員',   'リプライザル', '',                       0),
    (v_phase, '0:30',  '全体攻撃 (中)',     'WHM',    'テンパランス', '',                       1),
    (v_phase, '0:55',  'タンク強攻撃',       'PLD',    'シェルトロン', '',                       2),
    (v_phase, '1:20',  '全体攻撃 (大)',     'SCH',    '陣',           '',                       3),
    (v_phase, '1:45',  'デバフ散開',         '全員',   '個人軽減',     'マクロ参照',             4);

  INSERT INTO public.mitigation_phases (category_id, name, sort_order) VALUES (v_arc, 'P2 移動フェーズ', 1) RETURNING id INTO v_phase;
  INSERT INTO public.mitigation_entries (phase_id, time_label, mechanic, player_name, skill, note, sort_order) VALUES
    (v_phase, '2:10',  '線取り',             'タンク', 'インビン後',   '',                       0),
    (v_phase, '2:35',  '塔処理',             'DPS',    '個人軽減',     '',                       1),
    (v_phase, '2:55',  '全体攻撃',           'AST',    'マクロコスモス', 'ノクターン重ね',       2);

  INSERT INTO public.mitigation_phases (category_id, name, sort_order) VALUES (v_arc, 'P3 中ギミック', 2) RETURNING id INTO v_phase;
  INSERT INTO public.mitigation_entries (phase_id, time_label, mechanic, player_name, skill, note, sort_order) VALUES
    (v_phase, '3:20',  'ノックバック',       '全員',   'ステップ無敵', '',                       0),
    (v_phase, '3:50',  '頭割り',             'WHM',    'アサイラム',   '',                       1),
    (v_phase, '4:15',  '塔割り',             'SCH',    'セラフィム',   'WHM とローテ',           2),
    (v_phase, '4:40',  '全体大ダメージ',     'PLD',    '迅速 + パッセージ', '',                  3);

  INSERT INTO public.mitigation_phases (category_id, name, sort_order) VALUES (v_arc, 'P4 詰め', 3) RETURNING id INTO v_phase;
  INSERT INTO public.mitigation_entries (phase_id, time_label, mechanic, player_name, skill, note, sort_order) VALUES
    (v_phase, '5:00',  'エンレイジ前 大攻撃', 'AST',    'ホロスコープ', '',                       0),
    (v_phase, '5:20',  '頭割り',             'SCH',    '陣',           '',                       1),
    (v_phase, '5:45',  '全員集合',           '全員',   'ファイト or フライト', '',               2),
    (v_phase, '6:00',  'エンレイジ',         '-',      '-',            '撃破ライン',             3);

  -- variant: 1 phase 簡易
  INSERT INTO public.mitigation_phases (category_id, name, sort_order) VALUES (v_var, 'ボス戦全体', 0) RETURNING id INTO v_phase;
  INSERT INTO public.mitigation_entries (phase_id, time_label, mechanic, player_name, skill, note, sort_order) VALUES
    (v_phase, '0:30',  '範囲攻撃',           'WHM',    'テンパランス', '',                       0),
    (v_phase, '1:10',  'タンクスワップ',     'タンク', 'インビン交代', '',                       1),
    (v_phase, '1:50',  'ルート分岐確認',     '全員',   '-',            'ボス HP で判定',         2);

  -- extreme-cloud-of-darkness: 2 phase
  INSERT INTO public.mitigation_phases (category_id, name, sort_order) VALUES (v_ext, 'P1 通常戦', 0) RETURNING id INTO v_phase;
  INSERT INTO public.mitigation_entries (phase_id, time_label, mechanic, player_name, skill, note, sort_order) VALUES
    (v_phase, '0:25',  '全体攻撃',           'WHM',    'アサイラム',   '',                       0),
    (v_phase, '1:00',  'タンク強攻撃',       'PLD',    'シェルトロン', '',                       1),
    (v_phase, '1:35',  '頭割り',             'SCH',    '陣',           '',                       2);

  INSERT INTO public.mitigation_phases (category_id, name, sort_order) VALUES (v_ext, 'P2 LB チェック', 1) RETURNING id INTO v_phase;
  INSERT INTO public.mitigation_entries (phase_id, time_label, mechanic, player_name, skill, note, sort_order) VALUES
    (v_phase, '2:10',  '全体大ダメージ',     'AST',    'マクロコスモス', 'LB3 重ね',             0),
    (v_phase, '2:40',  'エンレイジ確認',     '-',      '-',            '',                       1);

  -- ultimate-omega-protocol: 6 phase 概形
  INSERT INTO public.mitigation_phases (category_id, name, sort_order) VALUES (v_omg, 'P1 通常',         0) RETURNING id INTO v_phase;
  INSERT INTO public.mitigation_entries (phase_id, time_label, mechanic, player_name, skill, note, sort_order) VALUES
    (v_phase, '0:30',  '全体攻撃',           'WHM',    'アサイラム',   '',                       0),
    (v_phase, '1:00',  '頭割り',             'SCH',    '陣',           '',                       1),
    (v_phase, '1:30',  'タンク強攻撃',       'PLD',    'シェルトロン', '',                       2);

  INSERT INTO public.mitigation_phases (category_id, name, sort_order) VALUES (v_omg, 'P2 OMEGA',        1) RETURNING id INTO v_phase;
  INSERT INTO public.mitigation_entries (phase_id, time_label, mechanic, player_name, skill, note, sort_order) VALUES
    (v_phase, '2:00',  'PROGRAM LOOP',       'AST',    'ホロスコープ', '',                       0),
    (v_phase, '2:30',  'CRITICAL ERROR',     '全員',   '個人軽減',     '',                       1),
    (v_phase, '3:00',  '全体攻撃',           'WHM',    'アサイラム',   '',                       2);

  INSERT INTO public.mitigation_phases (category_id, name, sort_order) VALUES (v_omg, 'P3 PROTEAN',      2) RETURNING id INTO v_phase;
  INSERT INTO public.mitigation_entries (phase_id, time_label, mechanic, player_name, skill, note, sort_order) VALUES
    (v_phase, '3:30',  'PROTEAN WAVE',       '全員',   '個人軽減',     '',                       0),
    (v_phase, '4:00',  'STORAGE VIOLATION',  'SCH',    '陣',           '',                       1),
    (v_phase, '4:30',  'タンク強攻撃',       'PLD',    'シェルトロン', '',                       2);

  INSERT INTO public.mitigation_phases (category_id, name, sort_order) VALUES (v_omg, 'P4 通常',         3) RETURNING id INTO v_phase;
  INSERT INTO public.mitigation_entries (phase_id, time_label, mechanic, player_name, skill, note, sort_order) VALUES
    (v_phase, '5:00',  '全体攻撃',           'AST',    'マクロコスモス', '',                     0),
    (v_phase, '5:30',  '頭割り',             'WHM',    'テンパランス', '',                       1);

  INSERT INTO public.mitigation_phases (category_id, name, sort_order) VALUES (v_omg, 'P5 BLUE SCREEN',  4) RETURNING id INTO v_phase;
  INSERT INTO public.mitigation_entries (phase_id, time_label, mechanic, player_name, skill, note, sort_order) VALUES
    (v_phase, '6:00',  'BLUE SCREEN',        '全員',   'LB3',          '',                       0),
    (v_phase, '6:30',  '全体大ダメージ',     'SCH',    'セラフィム',   '',                       1);

  INSERT INTO public.mitigation_phases (category_id, name, sort_order) VALUES (v_omg, 'P6 詰め',         5) RETURNING id INTO v_phase;
  INSERT INTO public.mitigation_entries (phase_id, time_label, mechanic, player_name, skill, note, sort_order) VALUES
    (v_phase, '7:00',  'エンレイジ前',       'AST',    'ホロスコープ', '',                       0),
    (v_phase, '7:30',  'エンレイジ',         '-',      '-',            '',                       1);

  -- ultimate-futures-rewritten: 5 phase
  INSERT INTO public.mitigation_phases (category_id, name, sort_order) VALUES (v_fru, 'P1 FATEBREAKER',          0) RETURNING id INTO v_phase;
  INSERT INTO public.mitigation_entries (phase_id, time_label, mechanic, player_name, skill, note, sort_order) VALUES
    (v_phase, '0:30',  'BURNT STRIKE',       'PLD',    'シェルトロン', '',                       0),
    (v_phase, '1:00',  'POWDER MARK TRAIL',  '全員',   '個人軽減',     '',                       1),
    (v_phase, '1:30',  '全体攻撃',           'WHM',    'アサイラム',   '',                       2);

  INSERT INTO public.mitigation_phases (category_id, name, sort_order) VALUES (v_fru, 'P2 USURPER OF FROST',     1) RETURNING id INTO v_phase;
  INSERT INTO public.mitigation_entries (phase_id, time_label, mechanic, player_name, skill, note, sort_order) VALUES
    (v_phase, '2:00',  'DIAMOND DUST',       'AST',    'マクロコスモス', '',                     0),
    (v_phase, '2:30',  '頭割り',             'SCH',    '陣',           '',                       1);

  INSERT INTO public.mitigation_phases (category_id, name, sort_order) VALUES (v_fru, 'P3 OPTIONAL',             2) RETURNING id INTO v_phase;
  INSERT INTO public.mitigation_entries (phase_id, time_label, mechanic, player_name, skill, note, sort_order) VALUES
    (v_phase, '3:00',  'INTERMISSION',       '-',      '-',            '休憩',                   0);

  INSERT INTO public.mitigation_phases (category_id, name, sort_order) VALUES (v_fru, 'P4 ULTIMATE RELATIVITY',  3) RETURNING id INTO v_phase;
  INSERT INTO public.mitigation_entries (phase_id, time_label, mechanic, player_name, skill, note, sort_order) VALUES
    (v_phase, '4:00',  'RELATIVITY',         '全員',   '個人軽減',     '',                       0),
    (v_phase, '4:30',  '頭割り',             'WHM',    'テンパランス', '',                       1),
    (v_phase, '5:00',  '全体大ダメージ',     'AST',    'ホロスコープ', '',                       2);

  INSERT INTO public.mitigation_phases (category_id, name, sort_order) VALUES (v_fru, 'P5 PANDORA',              4) RETURNING id INTO v_phase;
  INSERT INTO public.mitigation_entries (phase_id, time_label, mechanic, player_name, skill, note, sort_order) VALUES
    (v_phase, '6:00',  'PANDORA',            '全員',   'LB3',          'エンレイジ前',           0);

  -- ---- 1.6 strategy_docs ----
  INSERT INTO public.strategy_docs (category_id, title, body_md, updated_by_name) VALUES
    (v_arc, 'M5S 攻略メモ',
     E'# M5S 攻略メモ\n\n## 散開位置\n- 北 MT / 南 ST\n- 東西 D1〜D4\n\n## 軽減タイムライン\n- 0:30 全体: WHM テンパ\n- 1:20 全体大: SCH 陣 + LB2 確認\n\n## 注意点\n- ノックバック前にステップ無敵を切らさない\n- デバフ散開時のマクロは pinned 参照',
     'アルファ'),
    (v_var, '異聞商客物語 ルート分岐',
     E'# 異聞商客物語\n\n## ルート選択\n- HP 50% 時の挙動でルート判定\n  - A: ボス左移動 = 武器ルート\n  - B: ボス右移動 = 防具ルート\n  - C: 中央維持 = 素材ルート\n\n## 注意\n- 8 名 PT 専用、IL シンク確認\n- 初手は B 推奨 (火力チェックゆるい)',
     'チャーリー'),
    (v_ext, '極暗闇の雲 攻略 (撃破済)',
     E'# 極暗闇の雲 — クリア済\n\n## 散開\n- 北 MT / 南 ST\n- D1〜D4 時計回り\n\n## クリア時編成\n- PLD / WAR / WHM / SCH / DRG / SAM / BRD / SMN\n\n## 武器周回時の覚え書き\n- 火力チェックは余裕、軽減は P2 LB3 重ねのみ意識すれば安定',
     'エコー'),
    (v_omg, '絶オメガ検証戦 全体ノート',
     E'# 絶オメガ検証戦\n\n## フェーズ概要\n1. P1: 通常 (1:30 まで)\n2. P2: OMEGA (2:00〜)\n3. P3: PROTEAN (3:30〜)\n4. P4: 通常 (5:00〜)\n5. P5: BLUE SCREEN (6:00〜)\n6. P6: 詰め (7:00〜エンレイジ 7:30)\n\n## 現状\n- P3 PROTEAN まで安定、P4 突入直後で事故多め\n- 次回練習会で P4 詰め予定',
     'ゴルフ'),
    (v_fru, '絶もうひとつの未来 休止前メモ',
     E'# FRU 休止前メモ\n\n## 進捗\n- P4 ULTIMATE RELATIVITY 詰め中で休止\n- メンバー復帰後は P4 から再開\n\n## 引き継ぎ\n- 軽減タイムラインは pinned 参照\n- 散開図は最新版が strategy リンクの 1 番目',
     'アルファ');

  -- ---- 1.7 category_macros ----
  INSERT INTO public.category_macros (category_id, label, body, sort_order) VALUES
    (v_arc, 'カウントダウン',  E'/cd 5\n/p 開始します！軽減合わせをお願いします。', 0),
    (v_arc, '散開位置',         E'/p 【M5S 散開】\n/p 北 MT / 南 ST / 東西 D1〜D4\n/p デバフ散開はマクロ参照', 1),
    (v_var, 'カウントダウン',   E'/cd 5\n/p 異聞 開始します！', 0),
    (v_var, 'ルート選択',       E'/p ルート: B (防具)\n/p HP 50% で判定', 1),
    (v_ext, 'カウントダウン',   E'/cd 5\n/p 極 行きまーす', 0),
    (v_ext, 'LB3 タイミング',   E'/p P2 全体大ダメージで LB3\n/p 1:50 軽減合わせ', 1),
    (v_omg, 'カウントダウン',   E'/cd 5\n/p 絶 突入', 0),
    (v_omg, 'P3 散開',          E'/p 【P3 PROTEAN】\n/p 1MT / 2ST / 3D1 / 4D2 / 5D3 / 6D4 / 7H1 / 8H2', 1),
    (v_fru, 'カウントダウン',   E'/cd 5\n/p FRU 行きます', 0),
    (v_fru, 'P4 散開',          E'/p 【P4 ULTIMATE RELATIVITY】\n/p 散開図参照、軽減 4:00', 1);

  -- ---- 1.8 recruitment_templates ----
  INSERT INTO public.recruitment_templates (category_id, label, body, sort_order) VALUES
    (v_arc, '週固定 募集',
     E'【M5S〜M8S 週固定 募集】\n曜日: 火/木 22:00-24:00\nIL: 760 以上\nボイチャ: Discord 必須\n進捗: M5S 安定 / M6S 中ギミックまで\nDM 歓迎', 0),
    (v_var, '異聞 単発募集',
     E'【異聞商客物語 単発】\n日時: 今晩 21:00 〜\n人数: 8 名\nルート: B 経由\nIL: 740 以上\n初見歓迎、攻略事前読み込みお願いします', 0),
    (v_ext, '極 武器周回 募集',
     E'【極暗闇の雲 武器周回】\n気軽に 1 戦だけでも OK\n曜日: 不定 (Discord で告知)\n初見歓迎', 0),
    (v_omg, '絶オメガ 練習会',
     E'【絶オメガ 練習会 募集】\n曜日: 土 22:00-25:00\n進捗: P3 PROTEAN 練習中\nIL: 770 以上\n予習必須 (解説動画 link 共有あり)', 0),
    (v_fru, 'FRU 復帰待ち',
     E'【FRU 復帰メンバー募集】\n現在休止中、メンバー復帰待ち\n進捗: P4 ULTIMATE RELATIVITY\n復帰目処が立ったメンバーから DM ください', 0);

  -- ---- 1.9 tags ----
  INSERT INTO public.tags (target_type, target_id, label, color, created_by_name) VALUES
    ('category', v_arc, '現行零式',   'amber', 'アルファ'),
    ('category', v_arc, '週固定',     'sky',   'アルファ'),
    ('category', v_var, '8 名 PT',    'violet','チャーリー'),
    ('category', v_ext, 'クリア済',   'emerald','エコー'),
    ('category', v_omg, '絶級',       'rose',  'ゴルフ'),
    ('category', v_fru, '休止中',     'slate', 'アルファ'),
    ('strategy_doc',     (SELECT id FROM public.strategy_docs WHERE category_id = v_arc LIMIT 1), '最新版', 'amber', 'アルファ'),
    ('strategy_doc',     (SELECT id FROM public.strategy_docs WHERE category_id = v_omg LIMIT 1), 'WIP',    'rose',  'ゴルフ'),
    ('mitigation_entry', (SELECT id FROM public.mitigation_entries WHERE phase_id IN (SELECT id FROM public.mitigation_phases WHERE category_id = v_arc) ORDER BY created_at LIMIT 1), '要確認', 'rose', 'ブラボー'),
    ('loot_item',        (SELECT id FROM public.loot_items WHERE category_id = v_arc ORDER BY sort_order LIMIT 1), '次回優先', 'amber', 'アルファ'),
    ('loot_entry',       (SELECT id FROM public.loot_entries WHERE loot_item_id IN (SELECT id FROM public.loot_items WHERE category_id = v_arc) ORDER BY created_at LIMIT 1), 'ロット権', 'sky', 'アルファ');

  -- ---- 1.10 schedule_past_sessions (16 件 / 過去 8 週 × 週 2) ----
  -- 火曜 + 木曜の 22:00-24:00 を 8 週分。最も古い日 (2026-03-05) → 直近 (2026-04-30)
  INSERT INTO public.schedule_past_sessions (raw_date, parsed_date, start_time, end_time, day_of_week, source, attendances, user_names, logs_url, logs_url_source) VALUES
    ('2026/03/03 (火)', '2026-03-03T22:00:00+09:00', '22:00', '24:00', '火', 'snapshot', '{"アルファ":"◯","ブラボー":"◯","チャーリー":"◯","デルタ":"◯","エコー":"×","フォックス":"◯","ゴルフ":"◯","ホテル":"◯"}'::jsonb, '["アルファ","ブラボー","チャーリー","デルタ","エコー","フォックス","ゴルフ","ホテル"]'::jsonb, NULL, 'manual'),
    ('2026/03/05 (木)', '2026-03-05T22:00:00+09:00', '22:00', '24:00', '木', 'snapshot', '{"アルファ":"◯","ブラボー":"◯","チャーリー":"×","デルタ":"◯","エコー":"◯","フォックス":"◯","ゴルフ":"◯","ホテル":"×"}'::jsonb, '["アルファ","ブラボー","チャーリー","デルタ","エコー","フォックス","ゴルフ","ホテル"]'::jsonb, NULL, 'manual'),
    ('2026/03/10 (火)', '2026-03-10T22:00:00+09:00', '22:00', '24:00', '火', 'snapshot', '{"アルファ":"◯","ブラボー":"◯","チャーリー":"◯","デルタ":"◯","エコー":"◯","フォックス":"◯","ゴルフ":"◯","ホテル":"◯"}'::jsonb, '["アルファ","ブラボー","チャーリー","デルタ","エコー","フォックス","ゴルフ","ホテル"]'::jsonb, 'https://www.fflogs.com/reports/demoSCH01aaaaaa', 'auto'),
    ('2026/03/12 (木)', '2026-03-12T22:00:00+09:00', '22:00', '24:00', '木', 'snapshot', '{"アルファ":"◯","ブラボー":"×","チャーリー":"◯","デルタ":"◯","エコー":"◯","フォックス":"×","ゴルフ":"◯","ホテル":"◯"}'::jsonb, '["アルファ","ブラボー","チャーリー","デルタ","エコー","フォックス","ゴルフ","ホテル"]'::jsonb, NULL, 'manual'),
    ('2026/03/17 (火)', '2026-03-17T22:00:00+09:00', '22:00', '24:00', '火', 'snapshot', '{"アルファ":"◯","ブラボー":"◯","チャーリー":"◯","デルタ":"×","エコー":"◯","フォックス":"◯","ゴルフ":"◯","ホテル":"◯"}'::jsonb, '["アルファ","ブラボー","チャーリー","デルタ","エコー","フォックス","ゴルフ","ホテル"]'::jsonb, 'https://www.fflogs.com/reports/demoSCH02aaaaaa', 'auto'),
    ('2026/03/19 (木)', '2026-03-19T22:00:00+09:00', '22:00', '24:00', '木', 'snapshot', '{"アルファ":"◯","ブラボー":"◯","チャーリー":"◯","デルタ":"◯","エコー":"◯","フォックス":"◯","ゴルフ":"×","ホテル":"◯"}'::jsonb, '["アルファ","ブラボー","チャーリー","デルタ","エコー","フォックス","ゴルフ","ホテル"]'::jsonb, NULL, 'manual'),
    ('2026/03/24 (火)', '2026-03-24T22:00:00+09:00', '22:00', '24:00', '火', 'snapshot', '{"アルファ":"◯","ブラボー":"◯","チャーリー":"◯","デルタ":"◯","エコー":"◯","フォックス":"◯","ゴルフ":"◯","ホテル":"◯"}'::jsonb, '["アルファ","ブラボー","チャーリー","デルタ","エコー","フォックス","ゴルフ","ホテル"]'::jsonb, 'https://www.fflogs.com/reports/demoSCH03aaaaaa', 'auto'),
    ('2026/03/26 (木)', '2026-03-26T22:00:00+09:00', '22:00', '24:00', '木', 'snapshot', '{"アルファ":"×","ブラボー":"◯","チャーリー":"◯","デルタ":"◯","エコー":"◯","フォックス":"◯","ゴルフ":"◯","ホテル":"◯"}'::jsonb, '["アルファ","ブラボー","チャーリー","デルタ","エコー","フォックス","ゴルフ","ホテル"]'::jsonb, NULL, 'manual'),
    ('2026/03/31 (火)', '2026-03-31T22:00:00+09:00', '22:00', '24:00', '火', 'snapshot', '{"アルファ":"◯","ブラボー":"◯","チャーリー":"◯","デルタ":"◯","エコー":"◯","フォックス":"◯","ゴルフ":"◯","ホテル":"◯"}'::jsonb, '["アルファ","ブラボー","チャーリー","デルタ","エコー","フォックス","ゴルフ","ホテル"]'::jsonb, 'https://www.fflogs.com/reports/demoSCH04aaaaaa', 'auto'),
    ('2026/04/02 (木)', '2026-04-02T22:00:00+09:00', '22:00', '24:00', '木', 'snapshot', '{"アルファ":"◯","ブラボー":"◯","チャーリー":"×","デルタ":"◯","エコー":"◯","フォックス":"◯","ゴルフ":"◯","ホテル":"◯"}'::jsonb, '["アルファ","ブラボー","チャーリー","デルタ","エコー","フォックス","ゴルフ","ホテル"]'::jsonb, NULL, 'manual'),
    ('2026/04/07 (火)', '2026-04-07T22:00:00+09:00', '22:00', '24:00', '火', 'snapshot', '{"アルファ":"◯","ブラボー":"◯","チャーリー":"◯","デルタ":"◯","エコー":"◯","フォックス":"◯","ゴルフ":"◯","ホテル":"◯"}'::jsonb, '["アルファ","ブラボー","チャーリー","デルタ","エコー","フォックス","ゴルフ","ホテル"]'::jsonb, 'https://www.fflogs.com/reports/demoSCH05aaaaaa', 'auto'),
    ('2026/04/09 (木)', '2026-04-09T22:00:00+09:00', '22:00', '24:00', '木', 'snapshot', '{"アルファ":"◯","ブラボー":"◯","チャーリー":"◯","デルタ":"×","エコー":"◯","フォックス":"◯","ゴルフ":"◯","ホテル":"◯"}'::jsonb, '["アルファ","ブラボー","チャーリー","デルタ","エコー","フォックス","ゴルフ","ホテル"]'::jsonb, NULL, 'manual'),
    ('2026/04/14 (火)', '2026-04-14T22:00:00+09:00', '22:00', '24:00', '火', 'snapshot', '{"アルファ":"◯","ブラボー":"◯","チャーリー":"◯","デルタ":"◯","エコー":"◯","フォックス":"◯","ゴルフ":"◯","ホテル":"◯"}'::jsonb, '["アルファ","ブラボー","チャーリー","デルタ","エコー","フォックス","ゴルフ","ホテル"]'::jsonb, 'https://www.fflogs.com/reports/demoSCH06aaaaaa', 'auto'),
    ('2026/04/16 (木)', '2026-04-16T22:00:00+09:00', '22:00', '24:00', '木', 'snapshot', '{"アルファ":"◯","ブラボー":"◯","チャーリー":"◯","デルタ":"◯","エコー":"◯","フォックス":"◯","ゴルフ":"◯","ホテル":"◯"}'::jsonb, '["アルファ","ブラボー","チャーリー","デルタ","エコー","フォックス","ゴルフ","ホテル"]'::jsonb, NULL, 'manual'),
    ('2026/04/21 (火)', '2026-04-21T22:00:00+09:00', '22:00', '24:00', '火', 'snapshot', '{"アルファ":"◯","ブラボー":"◯","チャーリー":"◯","デルタ":"◯","エコー":"◯","フォックス":"◯","ゴルフ":"◯","ホテル":"◯"}'::jsonb, '["アルファ","ブラボー","チャーリー","デルタ","エコー","フォックス","ゴルフ","ホテル"]'::jsonb, 'https://www.fflogs.com/reports/demoSCH07aaaaaa', 'auto'),
    ('2026/04/23 (木)', '2026-04-23T22:00:00+09:00', '22:00', '24:00', '木', 'snapshot', '{"アルファ":"◯","ブラボー":"◯","チャーリー":"◯","デルタ":"◯","エコー":"◯","フォックス":"◯","ゴルフ":"◯","ホテル":"◯"}'::jsonb, '["アルファ","ブラボー","チャーリー","デルタ","エコー","フォックス","ゴルフ","ホテル"]'::jsonb, NULL, 'manual'),
    ('2026/04/28 (火)', '2026-04-28T22:00:00+09:00', '22:00', '24:00', '火', 'snapshot', '{"アルファ":"◯","ブラボー":"◯","チャーリー":"◯","デルタ":"◯","エコー":"◯","フォックス":"◯","ゴルフ":"◯","ホテル":"◯"}'::jsonb, '["アルファ","ブラボー","チャーリー","デルタ","エコー","フォックス","ゴルフ","ホテル"]'::jsonb, 'https://www.fflogs.com/reports/demoSCH08aaaaaa', 'auto'),
    ('2026/04/30 (木)', '2026-04-30T22:00:00+09:00', '22:00', '24:00', '木', 'snapshot', '{"アルファ":"◯","ブラボー":"◯","チャーリー":"◯","デルタ":"◯","エコー":"◯","フォックス":"◯","ゴルフ":"◯","ホテル":"◯"}'::jsonb, '["アルファ","ブラボー","チャーリー","デルタ","エコー","フォックス","ゴルフ","ホテル"]'::jsonb, 'https://www.fflogs.com/reports/demoSCH09aaaaaa', 'auto')
  ON CONFLICT (raw_date) DO NOTHING;

  -- ---- 1.11 schedule_session_memos ----
  INSERT INTO public.schedule_session_memos (raw_date, body, author_name) VALUES
    ('2026/04/30 (木)', 'M5S 初クリアおめでとうございます！次は M6S 練習に切替えます。', 'アルファ'),
    ('2026/04/30 (木)', '次回 22:00 開始、軽減 TL を pinned に更新済',                  'チャーリー'),
    ('2026/04/28 (火)', 'M5S 安定したので来週からはスキップ可',                          'ブラボー'),
    ('2026/04/23 (木)', '21:30 に Discord ボイチャ集合、開始 22:00',                     'アルファ'),
    ('2026/04/16 (木)', 'メンバー全員出席ありがとう！',                                  'エコー'),
    ('2026/04/09 (木)', 'M6S 練習回。デバフ散開要復習',                                  'デルタ'),
    ('2026/04/02 (木)', 'チャーリー欠席連絡あり。代理あり (ホテル)',                      'アルファ'),
    ('2026/03/24 (火)', 'M5S 初突入！ボイス確認お願いします',                            'アルファ');

  -- ---- 1.12 app_settings ----
  -- schedule_url の placeholder + sentinel + TODO #2 phase 4 native Discord notify defaults
  INSERT INTO public.app_settings (key, value) VALUES
    ('schedule_url',                              'https://character-sheets.appspot.com/schedule/list?key=demoplaceholder'),
    ('demo_seed_applied',                         '1'),
    ('native_schedule_discord_notify_enabled',    'true'),
    ('native_schedule_discord_notify_hour',       '12')
  ON CONFLICT (key) DO NOTHING;

  RAISE NOTICE 'Demo seed applied — categories=5, links=37, loot_items=18, mitigation_phases=20, mitigation_entries~=60, strategy_docs=5, macros=10, recruit_templates=5, tags=11, past_sessions=18, memos=8.';

END $$;

-- ---- 2. 追加コンテンツ seed (was schema.sql Section 13a) -------------------
-- ユーザー指定の追加リンク。Section 1 の demo seed sentinel に依存せず、
-- URL ベース NOT EXISTS guard で冪等 (重複 INSERT 回避)。Section 0 の sample
-- categories のうち arcadion-cruiser / arcadion-lightheavy は Section 1 の
-- demo data 対象外なので、本ブロックがそれらの最初のコンテンツ投入を担う。

DO $$
DECLARE
  v_arc      uuid;
  v_cruiser  uuid;
  v_lh       uuid;
BEGIN
  SELECT id INTO v_arc     FROM public.categories WHERE slug = 'arcadion-heavy';
  SELECT id INTO v_cruiser FROM public.categories WHERE slug = 'arcadion-cruiser';
  SELECT id INTO v_lh      FROM public.categories WHERE slug = 'arcadion-lightheavy';

  -- arcadion-heavy: 動画 + 攻略
  IF v_arc IS NOT NULL THEN
    INSERT INTO public.category_links (category_id, kind, title, url, source, sort_order)
    SELECT v_arc, 'video', 'M5S〜M8S 解説動画', 'https://www.youtube.com/watch?v=ZHoZ5981rPg', 'manual', 99
    WHERE NOT EXISTS (
      SELECT 1 FROM public.category_links
      WHERE category_id = v_arc AND url = 'https://www.youtube.com/watch?v=ZHoZ5981rPg'
    );

    INSERT INTO public.category_links (category_id, kind, title, url, source, sort_order)
    SELECT v_arc, 'strategy', 'FFXIV パッチ 7.4 公式 — ヘビー級', 'https://jp.finalfantasyxiv.com/dawntrail/patch_7_4/', 'manual', 99
    WHERE NOT EXISTS (
      SELECT 1 FROM public.category_links
      WHERE category_id = v_arc AND url = 'https://jp.finalfantasyxiv.com/dawntrail/patch_7_4/'
    );
  END IF;

  -- arcadion-cruiser: 動画 + 攻略
  IF v_cruiser IS NOT NULL THEN
    INSERT INTO public.category_links (category_id, kind, title, url, source, sort_order)
    SELECT v_cruiser, 'video', 'クルーザー級 解説動画', 'https://www.youtube.com/watch?v=X4rIEOt6Wl8', 'manual', 0
    WHERE NOT EXISTS (
      SELECT 1 FROM public.category_links
      WHERE category_id = v_cruiser AND url = 'https://www.youtube.com/watch?v=X4rIEOt6Wl8'
    );

    INSERT INTO public.category_links (category_id, kind, title, url, source, sort_order)
    SELECT v_cruiser, 'strategy', 'FFXIV パッチ 7.2 公式 — クルーザー級', 'https://jp.finalfantasyxiv.com/dawntrail/patch_7_2/', 'manual', 0
    WHERE NOT EXISTS (
      SELECT 1 FROM public.category_links
      WHERE category_id = v_cruiser AND url = 'https://jp.finalfantasyxiv.com/dawntrail/patch_7_2/'
    );
  END IF;

  -- arcadion-lightheavy: 動画 + 攻略
  IF v_lh IS NOT NULL THEN
    INSERT INTO public.category_links (category_id, kind, title, url, source, sort_order)
    SELECT v_lh, 'video', 'ライトヘビー級 解説動画', 'https://www.youtube.com/watch?v=aSU-swmCxVM', 'manual', 0
    WHERE NOT EXISTS (
      SELECT 1 FROM public.category_links
      WHERE category_id = v_lh AND url = 'https://www.youtube.com/watch?v=aSU-swmCxVM'
    );

    INSERT INTO public.category_links (category_id, kind, title, url, source, sort_order)
    SELECT v_lh, 'strategy', 'FFXIV: 黄金のレガシー 公式', 'https://jp.finalfantasyxiv.com/dawntrail/', 'manual', 0
    WHERE NOT EXISTS (
      SELECT 1 FROM public.category_links
      WHERE category_id = v_lh AND url = 'https://jp.finalfantasyxiv.com/dawntrail/'
    );
  END IF;
END $$;

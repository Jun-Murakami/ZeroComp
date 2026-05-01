// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Jun Murakami
import React from 'react';
import {
  Box,
  Dialog,
  DialogContent,
  DialogActions,
  Button,
  Divider,
  Link as MuiLink,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { DISPLAY_VERSION } from '../version';
import { openUrl } from '../bridge/juce';

// license-checker が prebuild で生成する JSON を静的取り込み
// - 形式: Record<"pkg@version", { licenses, publisher, repository, url, ... }>
// - 初回は空 {} が入る想定
import licensesRaw from '../assets/licenses.json';

type LicenseCheckerEntry = {
  licenses?: string | string[];
  publisher?: string;
  url?: string;
  repository?: string;
};

type LicensesMap = Record<string, LicenseCheckerEntry>;

function mapToRows(data: LicensesMap) {
  return Object.entries(data).map(([pkgAndVersion, info]) => {
    // 最後の '@' をバージョン境界としてパース（scoped package 対応）
    const at = pkgAndVersion.lastIndexOf('@');
    const name = at > 0 ? pkgAndVersion.slice(0, at) : pkgAndVersion;
    const version = at > 0 ? pkgAndVersion.slice(at + 1) : '';
    const licenses = Array.isArray(info.licenses) ? info.licenses.join(', ') : info.licenses || '';
    return {
      key: pkgAndVersion,
      name,
      version,
      licenses,
      publisher: info.publisher || '',
      repository: info.repository || info.url || '',
    };
  });
}

export interface LicenseDialogProps {
  open: boolean;
  onClose: () => void;
}

// ライセンスダイアログ（ヘッダーとテーブルを統合）
// - ダイアログ領域は縦フレックス
// - 上部のタイトル/クレジットは固定
// - 下部のテーブル領域のみ左右上下スクロール可能
export const LicenseDialog: React.FC<LicenseDialogProps> = ({ open, onClose }) => {
  // unknown として取り込んだ JSON を期待型へナローイング
  const data: LicensesMap = licensesRaw as unknown as LicensesMap;
  const rows = React.useMemo(() => mapToRows(data), [data]);

  // リンククリックハンドラー（OSのブラウザで開く）
  const handleLinkClick = (event: React.MouseEvent<HTMLAnchorElement>, url: string) => {
    event.preventDefault();
    openUrl(url);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      slotProps={{
        paper: {
          sx: {
            maxHeight: '85vh',
            display: 'flex',
            flexDirection: 'column',
          },
        },
      }}
    >
      <DialogContent sx={{ fontSize: '0.80rem', display: 'flex', flexDirection: 'column', gap: 1, flex: 1, minHeight: 0, p: 2 }}>
        {/* 見出し（中央寄せ）、その下にバージョン/クレジット */}
        <Box sx={{ textAlign: 'center', py: 0.5 }}>
          <Typography variant='h6' sx={{ fontWeight: 700, letterSpacing: 0.3, fontSize: '1.25rem' }}>
            ZeroComp
          </Typography>
          <Typography variant='caption' color='text.secondary' sx={{ fontSize: '0.72rem' }}>
            v{DISPLAY_VERSION}
          </Typography>
          <Typography variant='body2' sx={{ mt: 0.5, fontSize: '0.80rem' }}>
            Developed by{' '}
            <MuiLink
              href='https://jun-murakami.web.app/'
              onClick={(e) => handleLinkClick(e, 'https://jun-murakami.web.app/')}
              sx={{ cursor: 'pointer' }}
            >
              Jun Murakami
            </MuiLink>
          </Typography>
          <Typography variant='body2' color='text.secondary' sx={{ fontSize: '0.78rem' }}>
            Made with JUCE
          </Typography>
        </Box>

        <Divider sx={{ my: 0.5 }} />

        {/* Core SDK / Libraries */}
        <Typography variant='subtitle2' sx={{ fontWeight: 600, fontSize: '0.80rem' }}>
          Core Libraries
        </Typography>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25, pl: 1, mb: 0.5 }}>
          {[
            { name: 'JUCE', license: 'AGPLv3 / Commercial', url: 'https://juce.com/' },
            { name: 'VST3 SDK', license: 'MIT', url: 'https://github.com/steinbergmedia/vst3sdk' },
            { name: 'AAX SDK', license: 'GPLv3 / Commercial (Avid)', url: 'https://developer.avid.com/aax' },
          ].map((lib) => (
            <Box key={lib.name} sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75, fontSize: '0.75rem' }}>
              <MuiLink
                href={lib.url}
                onClick={(e) => handleLinkClick(e, lib.url)}
                sx={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.75rem', minWidth: 130 }}
              >
                {lib.name}
              </MuiLink>
              <Typography variant='caption' color='text.secondary' sx={{ fontSize: '0.70rem' }}>
                {lib.license}
              </Typography>
            </Box>
          ))}
        </Box>

        <Divider sx={{ my: 0.5 }} />

        {/* テーブル見出し（固定） */}
        <Typography variant='subtitle2' sx={{ fontWeight: 600, fontSize: '0.80rem' }}>
          Frontend Dependencies
        </Typography>

        {/* テーブル領域：余白を全て占有し、ここだけスクロール。
            プラグインウィンドウが小さい時に flex で 0 まで潰れて見切れないよう、最低 100px を確保する。
            この最低値を下回るような小さい画面ではダイアログ全体（DialogContent）がスクロールして
            テーブル見出しまで辿り着けるようにする。 */}
        <TableContainer component={Paper} variant='outlined' sx={{ flex: 1, minHeight: 100, overflow: 'auto' }}>
          <Table
            size='small'
            stickyHeader
            sx={{
              '& th, & td': { fontSize: '0.72rem', lineHeight: 1.2, py: 0.5, px: 1 },
              '& thead th': { fontWeight: 700 },
            }}
          >
            <TableHead>
              <TableRow>
                <TableCell>Package</TableCell>
                <TableCell>License</TableCell>
                <TableCell>Publisher</TableCell>
                <TableCell>Repository</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4}>
                    <Typography variant='body2' color='text.secondary' sx={{ fontSize: '0.78rem' }}>
                      ライセンス情報は未生成です。ビルド時に自動生成されます。
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r) => (
                  <TableRow key={r.key} hover>
                    <TableCell>
                      <Typography variant='body2' sx={{ fontWeight: 600, fontSize: '0.78rem' }}>
                        {r.name}
                      </Typography>
                      <Typography variant='caption' color='text.secondary' sx={{ fontSize: '0.68rem' }}>
                        {r.version}
                      </Typography>
                    </TableCell>
                    <TableCell>{r.licenses}</TableCell>
                    <TableCell>{r.publisher}</TableCell>
                    <TableCell sx={{ maxWidth: 220, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {r.repository ? (
                        <MuiLink
                          href={r.repository}
                          onClick={(e) => handleLinkClick(e, r.repository)}
                          sx={{ cursor: 'pointer' }}
                        >
                          {r.repository}
                        </MuiLink>
                      ) : (
                        <Typography variant='caption' color='text.secondary'>
                          -
                        </Typography>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </DialogContent>
      <DialogActions sx={{ px: 1, py: 0.5 }}>
        <Button onClick={onClose} variant='contained' size='small' sx={{ py: 0.25, px: 1.25, fontSize: '0.80rem' }}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default LicenseDialog;

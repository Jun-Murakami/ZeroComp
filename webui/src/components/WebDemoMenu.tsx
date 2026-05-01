// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Jun Murakami
import React, { useState } from 'react';
import {
  Box,
  Button,
  Drawer,
  IconButton,
  Typography,
  Divider,
  Tooltip,
  useMediaQuery,
} from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import CloseIcon from '@mui/icons-material/Close';

// セクション定義は src/assets/web_demos.json を参照。
// 親リポジトリ（JUCE/）に web_demos.json があれば prebuild の sync スクリプトで上書きされる。
import menuSectionsJson from '../assets/web_demos.json';

// ============================================================================
// WebDemoMenu
// ============================================================================
//  Web デモ専用のナビゲーション。
//  - viewport >= 1200px: 右側に常時表示の docked drawer（variant='permanent'）
//  - それ未満: 右下にハンバーガー → temporary drawer
//  リンクは同ページ遷移（target='_blank' 無し）。

interface MenuLink { readonly label: string; readonly href: string }
interface MenuSection { readonly title: string; readonly links: ReadonlyArray<MenuLink> }

// 常時表示モードのしきい値と drawer 幅。App.tsx の outer padding 調整にも使う。
export const MENU_WIDE_QUERY    = '(min-width:1200px)';
export const MENU_DRAWER_WIDTH  = 280;

const MENU_SECTIONS: ReadonlyArray<MenuSection> = menuSectionsJson;

export const WebDemoMenu: React.FC = () => {
  const wide = useMediaQuery(MENU_WIDE_QUERY);
  const [open, setOpen] = useState(false);
  const handleOpen = () => setOpen(true);
  const handleClose = () => setOpen(false);

  const content = (
    <Box sx={{ width: '100%', display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', px: 2, py: 1.5 }}>
        <Typography variant='subtitle1' sx={{ fontWeight: 600, color: 'primary.main' }}>
          Menu
        </Typography>
        {!wide && (
          <IconButton onClick={handleClose} size='small' aria-label='close menu'>
            <CloseIcon fontSize='small' />
          </IconButton>
        )}
      </Box>
      <Divider />

      {MENU_SECTIONS.map((section, sectionIdx) => (
        <Box key={section.title}>
          <Typography
            variant='caption'
            sx={{
              display: 'block',
              px: 2,
              pt: 2,
              pb: 0.5,
              color: 'text.primary',
              fontWeight: 600,
              letterSpacing: 0.5,
            }}
          >
            {section.title}
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, px: 2, pb: 1 }}>
            {section.links.map((link) => (
              <Button
                key={link.href}
                component='a'
                href={link.href}
                size='small'
                variant='text'
                sx={{
                  textTransform: 'none',
                  fontSize: '0.8rem',
                  minWidth: 'auto',
                  px: 1,
                  py: 0.25,
                }}
              >
                {link.label}
              </Button>
            ))}
          </Box>
          {sectionIdx < MENU_SECTIONS.length - 1 && <Divider sx={{ mt: 1 }} />}
        </Box>
      ))}
    </Box>
  );

  if (wide)
  {
    return (
      <Drawer
        anchor='right'
        open
        variant='permanent'
        slotProps={{ paper: { sx: { width: MENU_DRAWER_WIDTH, boxShadow: 4, borderLeft: '1px solid', borderColor: 'divider', overflowX: 'hidden' } } }}
      >
        {content}
      </Drawer>
    );
  }

  return (
    <>
      <Tooltip title='Menu' arrow>
        <IconButton
          onClick={handleOpen}
          aria-label='open menu'
          size='medium'
          sx={{
            position: 'fixed',
            right: 16,
            bottom: 16,
            zIndex: 1200,
            backgroundColor: 'background.paper',
            border: '1px solid',
            borderColor: 'divider',
            boxShadow: 3,
            '&:hover': { backgroundColor: 'grey.800' },
          }}
        >
          <MenuIcon fontSize='small' />
        </IconButton>
      </Tooltip>

      {open && (
        <Drawer anchor='right' open={open} onClose={handleClose}>
          {content}
        </Drawer>
      )}
    </>
  );
};

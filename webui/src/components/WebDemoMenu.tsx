import React, { useState } from 'react';
import {
  Box,
  Drawer,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Typography,
  Divider,
  Tooltip,
} from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import CloseIcon from '@mui/icons-material/Close';

// ============================================================================
// WebDemoMenu
// ============================================================================
//  Web デモ専用のハンバーガー付きドロワー。
//  - 右下にフロート配置したアイコンボタンでドロワーを開閉
//  - ドロワー本体 + 中身は `open === true` のときだけマウントする（閉じた状態では DOM に残さない）
//  - ドロワーは "Download Plugin" と "Source Code" の 2 セクションを持ち、それぞれ外部リンク

interface MenuLink { readonly label: string; readonly href: string }
interface MenuSection { readonly title: string; readonly links: ReadonlyArray<MenuLink> }

const MENU_SECTIONS: ReadonlyArray<MenuSection> = [
  {
    title: 'Demo Site',
    links: [
      { label: 'ZeroEQ',    href: 'https://zeroeq-demo.web.app/' },
      { label: 'ZeroComp',  href: 'https://zerocomp-demo.web.app/' },
      { label: 'ZeroLimit', href: 'https://zerolimit-demo.web.app/' },
    ],
  },
  {
    title: 'Download Plugin',
    links: [
      { label: 'ZeroEQ',    href: 'https://jun-murakami.web.app/#zeroEq' },
      { label: 'ZeroComp',  href: 'https://jun-murakami.web.app/#zeroComp' },
      { label: 'ZeroLimit', href: 'https://jun-murakami.web.app/#zeroLimit' },
    ],
  },
  {
    title: 'Source Code',
    links: [
      { label: 'ZeroEQ',    href: 'https://github.com/Jun-Murakami/ZeroEQ' },
      { label: 'ZeroComp',  href: 'https://github.com/Jun-Murakami/ZeroComp' },
      { label: 'ZeroLimit', href: 'https://github.com/Jun-Murakami/ZeroLimit' },
    ],
  },
  {
    title: 'Other Plugins / Software',
    links: [
      { label: 'jun-murakami.web.app', href: 'https://jun-murakami.web.app' },
    ],
  },
];

export const WebDemoMenu: React.FC = () => {
  const [open, setOpen] = useState(false);
  const handleOpen = () => setOpen(true);
  const handleClose = () => setOpen(false);

  return (
    <>
      {/* 右下フロートのハンバーガー */}
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

      {/* Drawer は open 時だけマウント（`{open && ...}` で常時マウントを回避） */}
      {open && (
        <Drawer
          anchor='right'
          open={open}
          onClose={handleClose}
          // MUI Drawer の default（keepMounted=false）で children は閉じると unmount されるが、
          //  ここでは Drawer コンポーネント自体も開いたときだけマウントする。
        >
          <Box sx={{ width: 280, display: 'flex', flexDirection: 'column', height: '100%' }}>
            {/* ヘッダ: タイトル + 閉じるボタン */}
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', px: 2, py: 1.5 }}>
              <Typography variant='subtitle1' sx={{ fontWeight: 600, color: 'primary.main' }}>
                Menu
              </Typography>
              <IconButton onClick={handleClose} size='small' aria-label='close menu'>
                <CloseIcon fontSize='small' />
              </IconButton>
            </Box>
            <Divider />

            {/* リンクセクション */}
            {MENU_SECTIONS.map((section, sectionIdx) => (
              <Box key={section.title}>
                <Typography
                  variant='caption'
                  sx={{
                    display: 'block',
                    px: 2,
                    pt: 2,
                    pb: 0.5,
                    color: 'text.secondary',
                    fontWeight: 600,
                    letterSpacing: 0.5,
                    textTransform: 'uppercase',
                  }}
                >
                  {section.title}
                </Typography>
                <List dense disablePadding>
                  {section.links.map((link) => (
                    <ListItem key={link.href} disablePadding>
                      <ListItemButton
                        component='a'
                        href={link.href}
                        target='_blank'
                        rel='noopener noreferrer'
                      >
                        <ListItemText
                          primary={link.label}
                          sx={{ '& .MuiListItemText-primary': { fontSize: '0.9rem' } }}
                        />
                      </ListItemButton>
                    </ListItem>
                  ))}
                </List>
                {sectionIdx < MENU_SECTIONS.length - 1 && <Divider sx={{ mt: 1 }} />}
              </Box>
            ))}
          </Box>
        </Drawer>
      )}
    </>
  );
};

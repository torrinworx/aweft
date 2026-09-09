// The JSX namespace this package's `h` is written against, pointed at rather than imported: a
// `.d.ts` has no runtime half, and a project that consumes this package writes JSX against it.
/// <reference path="./jsx.d.ts" />

import './defaults.ts';

export { h, svg, html } from './h.ts';
export { template } from './template.ts';
export { mark, categories } from './mark.ts';
export type { Category, Mark, Marked, MarkMaker } from './mark.ts';

export { context, hydrate, mount, render, use } from './render.ts';
export type { Render } from './render.ts';
export type { Ids, Registry } from './registry.ts';

export { dark, light } from './modes.ts';
export { Head, Link, Meta, Script, Style, Title } from './head.tsx';
export type { TagProps } from './head.tsx';
export type { HeadKind, HeadList, HeadTag } from './head-list.ts';

export { Default, Stage, StageContext } from './stage.tsx';
export type { Act, ActComponent, LazyAct, OpenOptions, StageContextComponent, StageProps, StageValue } from './stage.tsx';
export type { ActEntries, StageAct, StageEntry } from './stage-entry.ts';

export { Theme } from './theme-api.ts';
export type { ThemeApi } from './theme-api.ts';
export { ThemeContext } from './themed.tsx';
export type { ThemeCascade, Themed } from './themed.tsx';
export type { Definitions, Entry, Sheet } from './sheet.ts';
export { sizeProperties } from './values.ts';
export type { ThemeFunction } from './values.ts';

export type { Component } from './component.ts';
export { createContext } from './contexts.ts';
export type { Context, ContextNode, ProviderProps, Transform } from './contexts.ts';

export { Button } from './button.tsx';
export type { ButtonProps } from './button.tsx';
export { Checkbox } from './checkbox.tsx';
export type { CheckboxProps } from './checkbox.tsx';
export { Icon, Icons } from './icon.tsx';
export type { IconProps } from './icon.tsx';
export type { IconAlias, IconData, IconPack, IconResolver, IconSource } from './icon-data.ts';
export { standardIcons } from './icon-names.ts';
export { LoadingDots } from './loading-dots.tsx';
export type { LoadingDotsProps } from './loading-dots.tsx';
export { Radio } from './radio.tsx';
export type { RadioProps } from './radio.tsx';
export { Select } from './select.tsx';
export type { SelectProps } from './select.tsx';
export { Slider } from './slider.tsx';
export type { SliderProps } from './slider.tsx';
export { TextArea } from './text-area.tsx';
export type { TextAreaProps } from './text-area.tsx';
export { TextField } from './text-field.tsx';
export type { TextFieldProps } from './text-field.tsx';
export { Toggle } from './toggle.tsx';
export type { ToggleProps } from './toggle.tsx';
export { TextModifiers, Typography } from './typography.tsx';
export type { TextModifier, TypographyProps } from './typography.tsx';

export { Alert } from './alert.tsx';
export type { AlertProps } from './alert.tsx';
export { Breadcrumb } from './breadcrumb.tsx';
export type { BreadcrumbItem, BreadcrumbProps } from './breadcrumb.tsx';
export { Avatar } from './avatar.tsx';
export type { AvatarProps } from './avatar.tsx';
export { Badge } from './badge.tsx';
export type { BadgeProps } from './badge.tsx';
export { Card } from './card.tsx';
export type { CardProps } from './card.tsx';
export { Empty } from './empty.tsx';
export type { EmptyProps } from './empty.tsx';
export { Pagination } from './pagination.tsx';
export type { PaginationProps } from './pagination.tsx';
export { Progress } from './progress.tsx';
export type { ProgressProps } from './progress.tsx';
export { Skeleton } from './skeleton.tsx';
export type { SkeletonProps } from './skeleton.tsx';
export { Table } from './table.tsx';
export type { TableColumn, TableProps } from './table.tsx';
export { Tab, TabPanel, Tabs } from './tabs.tsx';
export type { TabItem, TabPanelProps, TabProps, TabsProps } from './tabs.tsx';
export { ToggleGroup } from './toggle-group.tsx';
export type { ToggleGroupProps } from './toggle-group.tsx';

export { ColorPicker } from './color-picker.tsx';
export type { ColorPickerProps } from './color-picker.tsx';
export { DropDown } from './drop-down.tsx';
export type { DropDownProps } from './drop-down.tsx';
export { FileDrop } from './file-drop.tsx';
export type { FileDropComponent, FileDropEntry, FileDropProps } from './file-drop.tsx';
export { Modal } from './modal.tsx';
export type { ModalProps } from './modal.tsx';
export { Tooltip } from './tooltip.tsx';
export type { TooltipProps } from './tooltip.tsx';
export { Validate, ValidateContext } from './validate.tsx';
export type { ValidateContextProps, ValidateProps } from './validate.tsx';

export { Shown, Switch } from './flow.tsx';
export { LoaderContext, suspend } from './suspend.tsx';
export type { Loader, Loaders } from './suspend.tsx';

export { Detached, Popup, PopupContext, trackedMount } from './popup.tsx';
export type { PopupPlacement } from './popup.tsx';
export type { Placed, Placement, Rect } from './placement.ts';

export { InputContext } from './input.ts';
export type { Input } from './input.ts';
export { useAbort } from './abort.ts';

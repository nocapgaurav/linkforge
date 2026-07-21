import { Router } from 'express';
import { analyticsController } from '../../composition.js';

/**
 * Analytics sub-resource routes, mounted at /api/v1/urls alongside the URL
 * module's router (two-segment paths never collide with its /:shortCode
 * single-segment routes). Routing only.
 */
export const analyticsRouter = Router();

analyticsRouter.get('/:shortCode/analytics', analyticsController.getUrlAnalytics);

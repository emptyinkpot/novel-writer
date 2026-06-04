'use client'

import Header from '@/components/layout/Header'
import Footer from '@/components/layout/Footer'
import HeroSection from '@/components/home/HeroSection'
import CommunitySection from '@/components/home/CommunitySection'
import WorkspaceSection from '@/components/home/WorkspaceSection'
import FeatureCards from '@/components/home/FeatureCards'
import FeaturesSection from '@/components/home/FeaturesSection'
import TestimonialsSection from '@/components/home/TestimonialsSection'
import TutorialsSection from '@/components/home/TutorialsSection'
import PricingOverview from '@/components/home/PricingOverview'
import FAQSection from '@/components/home/FAQSection'
import FinalCTA from '@/components/home/FinalCTA'

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1">
        <HeroSection />
        <CommunitySection />
        <WorkspaceSection />
        <FeatureCards />
        <FeaturesSection />
        <TestimonialsSection />
        <TutorialsSection />
        <PricingOverview />
        <FAQSection />
        <FinalCTA />
      </main>
      <Footer />
    </div>
  )
}
